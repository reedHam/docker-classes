import { setTimeout } from 'timers/promises';
import { DockerContainer, DockerContainerSwarm, imageExists, pullImage, runExec, runExecStream, waitUntil } from "../lib";
import { randomUUID } from 'crypto';
import path from "path";

jest.setTimeout(30000);

test("Pulls a docker image", async () => {
    const pullResponse = await pullImage("alpine:latest");
    expect(pullResponse).toBeInstanceOf(Array);
    expect(pullResponse[0].status).toBe("Pulling from library/alpine");
    expect(pullResponse.pop()?.status).toMatch(/Image is up to date|Downloaded newer image/)
    await expect(pullImage("invalid-image-name")).rejects.toThrowError(/HTTP code 404/);
    await expect(pullImage("ALPINE")).rejects.toThrowError(/HTTP code 400/);
});

test("Checks if an image exists", async () => {
    expect(await imageExists("alpine")).toBeTruthy();
    expect(await imageExists("alpine:latest")).toBeTruthy();
    expect(await imageExists("alpine:invalid")).toBeFalsy();
    expect(await imageExists("invalid-image-name")).toBeFalsy();
});

test("Creates a container", async () => {
    const uuid = randomUUID();
    const container = new DockerContainer({
        Image: "alpine:latest",
        name: uuid,
    });
    expect(container.container).toBeNull();
    await container.createContainer();
    expect(container.container).not.toBeNull();
    await container.remove();
    await container.waitRemoved();
    expect(await container.getContainer()).toBeNull();
});



async function createWaitingContainer() {
    const uuid = randomUUID();
    const container = new DockerContainer({
        Image: "alpine:latest",
        name: uuid,
        Cmd: [
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

        const { stdOut, stdErr } = await runExec(realContainer!, ["echo", "Hello World!"]);
        expect(stdOut.toString()).toBe("Hello World!\n");
        expect(stdErr.toString()).toBe("");

    } finally {
        await cleanUpContainer(container);
    }
});

test("Runs a command stream on a container", async () => {
    const container = await createWaitingContainer();
    try {
        const realContainer = await container.getContainer();
        expect(realContainer).not.toBeNull();

        for await (const { stdOut, stdErr } of runExecStream(realContainer!, ["echo", "Hello World!"])) {
            if (stdOut) {
                expect(stdOut.toString()).toBe("Hello World!\n");
            }
            if (stdErr) {
                expect(stdErr.toString()).toBe("");
            }
        }
    } finally {
        await cleanUpContainer(container);
    }
});


test("Docker Container Swarm", async () => {
    const dockerContainerSwarm = new DockerContainerSwarm("alpine-swarm", 2, {
        alpineService: {
            Image: "alpine:latest",
            Cmd: [
                "sh",
                "-c",
                'while sleep 3600; do :; done'
            ]
        }
    });
    dockerContainerSwarm.start();
    await dockerContainerSwarm.waitReady();
    const containers = await dockerContainerSwarm.getContainers();
    expect(containers.length).toBe(2);
    // Remove a container and see if service recreates the dead container 
    await containers[0].remove({ force: true });
    await setTimeout(1000);
    const containers2 = await dockerContainerSwarm.getContainers();
    expect(containers2.length).toBe(2);
    dockerContainerSwarm.scale(3);
    await dockerContainerSwarm.waitReady();
    const containers3 = await dockerContainerSwarm.getContainers();
    expect(containers3.length).toBe(3);

    dockerContainerSwarm.scale(1);
    await dockerContainerSwarm.waitReady();
    const containers4 = await dockerContainerSwarm.getContainers();
    expect(containers4.length).toBe(1);
    
    await dockerContainerSwarm.stop();
    const containersEnd = await dockerContainerSwarm.getContainers();
    expect(containersEnd.length).toBe(0);
});


test("Scale a DockerContainerSwarm with a service", async () => {
    const dockerContainerSwarm = new DockerContainerSwarm("alpine-swarm", 2, {
        alpineService: {
            Image: "alpine:latest",
            Cmd: [
                "sh",
                "-c",
                'while sleep 3600; do :; done'
            ]
        }
    });
    dockerContainerSwarm.start();
    await dockerContainerSwarm.waitReady();
    const containers = await dockerContainerSwarm.getContainers();
    expect(containers.length).toBe(2);
    await setTimeout(200);

    const sleepCmd = [
        "sh",
        "-c",
        'while sleep 3600; do :; done'
    ];
    dockerContainerSwarm.runOnSwarm(sleepCmd);
    await setTimeout(200);

    const totalExecLoad = async (count: number): Promise<number> => {
        let totalLoad = 0;
        const getTotalExecLoad = async (): Promise<number> => {
            const execs = await dockerContainerSwarm.getExecLoad();
            totalLoad = Array.from(execs.entries()).reduce((acc, [, exec]) => acc + exec, 0);
            return totalLoad;
        };
        await waitUntil(async () => await getTotalExecLoad() === count);
        return totalLoad;
    }
    
    expect(await totalExecLoad(1)).toBe(1);

    dockerContainerSwarm.runOnSwarm(sleepCmd);
    await setTimeout(200);
    
    expect(await totalExecLoad(2)).toBe(2);

    for (let i = 0; i < 100; i++) {
        dockerContainerSwarm.runOnSwarm(sleepCmd);
    }

    expect(await totalExecLoad(102)).toBe(102);

    const execLoad = await dockerContainerSwarm.getExecLoad();
    const loadArr = Array.from(execLoad.entries());
    expect(loadArr[0][1]).toBeGreaterThan(30);
    expect(loadArr[0][1]).toBeLessThan(70);
    expect(loadArr[1][1]).toBeGreaterThan(30);
    expect(loadArr[1][1]).toBeLessThan(70);

    await dockerContainerSwarm.stop();
    const containersEnd = await dockerContainerSwarm.getContainers();
    expect(containersEnd.length).toBe(0);
});