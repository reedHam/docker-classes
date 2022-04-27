import { DockerContainer } from "../src";
import { randomUUID } from 'crypto';
import path from "path";
import { DOCKER_CONN } from "../src";

const TEST_DATA_DIR = './docker-test-data';

jest.setTimeout(30000);

test("Checks if an image exists", async () => {
    async function testImageName(name: string) {
        const container = new DockerContainer(name);
        return container.imageExists();
    }
    
    expect(await testImageName("alpine")).toBeTruthy();
    expect(await testImageName("alpine:latest")).toBeTruthy();
    expect(await testImageName("alpine:invalid")).toBeFalsy();
    expect(await testImageName("invalid-image-name")).toBeFalsy();
});

test("Pulls a docker image", async () => {
    const container = new DockerContainer("alpine:latest");

    const pullResponse = await container.pullImage();
    expect(pullResponse).toBeInstanceOf(Array);
    expect(pullResponse[0].status).toBe("Pulling from library/alpine");
    expect(pullResponse[pullResponse.length - 1].status).toBe("Status: Image is up to date for alpine:latest");

    const imageName = "invalid-image-name";
    const testContainer = new DockerContainer(imageName);
    
    await expect(testContainer.pullImage()).rejects.toThrowError(/HTTP code 404/);
});

test("Creates a container", async () => {
    const container = new DockerContainer("alpine:latest");
    expect(container.container).toBeNull();
    await container.createContainer();
    expect(container.container).not.toBeNull();
});

test("Starts and removes a container", async () => {
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
    expect(container.containerName).toBe(uuid);
    expect(path.basename((await container.container!.inspect()).Name)).toBe(uuid);
    
    await container.remove();
    await container.waitRemoved();
    expect(await container.getContainer()).toBeNull();
});

