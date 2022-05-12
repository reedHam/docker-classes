import { DockerContainer, imageExists, pullImage, resolveDockerStream, runExec, runExecFile, runExecStream } from "../lib";
import { randomUUID } from 'crypto';
import path from "path";
import { DOCKER_CONN } from "../lib";
import stream from 'stream';

const TEST_DATA_DIR = './docker-test-data';

jest.setTimeout(30000);

test("Checks if an image exists", async () => {
    expect(await imageExists("alpine")).toBeTruthy();
    expect(await imageExists("alpine:latest")).toBeTruthy();
    expect(await imageExists("alpine:invalid")).toBeFalsy();
    expect(await imageExists("invalid-image-name")).toBeFalsy();
});

test("Pulls a docker image", async () => {
    const pullResponse = await pullImage("alpine:latest");
    expect(pullResponse).toBeInstanceOf(Array);
    expect(pullResponse[0].status).toBe("Pulling from library/alpine");
    expect(pullResponse[pullResponse.length - 1].status).toBe("Status: Image is up to date for alpine:latest");
    await expect(pullImage("invalid-image-name")).rejects.toThrowError(/HTTP code 404/);
    await expect(pullImage("ALPINE")).rejects.toThrowError(/HTTP code 400/);
});

test("Creates a container", async () => {
    const container = new DockerContainer("alpine:latest");
    expect(container.container).toBeNull();
    await container.createContainer();
    expect(container.container).not.toBeNull();
    await container.remove();
    await container.waitRemoved();
    expect(await container.getContainer()).toBeNull();
});



async function createWaitingContainer() {
    const uuid = randomUUID();
    const container = new DockerContainer(
        "alpine:latest",
        {
            containerName: uuid,
            cmd: [
                "sh",
                "-c",
                'while sleep 3600; do :; done'
            ]
        });
    expect(container.container).toBeNull();
    await container.start();
    expect(await container.waitReady()).toBeTruthy();
    expect(container.container).not.toBeNull();
    expect(await container.isRunning()).toBeTruthy();
    expect(container.container).not.toBeNull();
    expect(container.name).toBe(uuid);
    expect(path.basename((await container.container!.inspect()).Name)).toBe(uuid);
    return container;
}

async function cleanUpContainer(container: DockerContainer) {
    await container.remove();
    await container.waitRemoved();
    expect(await container.getContainer()).toBeNull();
}

test("Starts and removes a container", async () => {
    const container = await createWaitingContainer();
    await cleanUpContainer(container);
});

test("Runs a command on a container", async () => {
    const container = await createWaitingContainer();
    try {
        const realContainer = await container.getContainer();
        expect(realContainer).not.toBeNull();

        const [stdout, stdErr] = await runExec(realContainer!, ["echo", "Hello World!"]);
        expect(stdout.toString()).toBe("Hello World!\n");
        expect(stdErr.toString()).toBe("");

    } catch (e) {
        throw e;
    } finally {
        await cleanUpContainer(container);
    }
});

test("Runs a command stream on a container", async () => {
    const container = await createWaitingContainer();
    try {
        const realContainer = await container.getContainer();
        expect(realContainer).not.toBeNull();

        for await (const [stdout, stdErr] of await runExecStream(realContainer!, ["echo", "Hello World!"])) {
            if (stdout) {
                expect(stdout.toString()).toBe("Hello World!\n");
            }
            if (stdErr) {
                expect(stdErr.toString()).toBe("");
            }
        }
    } catch (e) {
        throw e;
    } finally {
        await cleanUpContainer(container);
    }
});

test("Runs a command on a file on a container", async () => {
    const container = await createWaitingContainer();
    try {
        const realContainer = await container.getContainer();
        expect(realContainer).not.toBeNull();
        await runExecFile(realContainer!, "echo \"Hello World!\"", 'hello-world.txt');

        for await (const [stdout, stdErr] of await getFileStream(realContainer!, '/hello-world.txt')) {
            if (stdout) {
                expect(stdout.toString()).toBe("Hello World!\n");
            }
            if (stdErr) {
                expect(stdErr.toString()).toBe(""); 
            }
            break;
        }
    } catch (e) {
        throw e;
    } finally {
        //await cleanUpContainer(container);
    }
});

