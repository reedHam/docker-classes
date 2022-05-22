import { DockerContainerSwarm, isContainerRunning, waitForTotalExecLoad } from "../lib";
import { setTimeout } from 'timers/promises';

jest.setTimeout(30000);

test("Docker Container Swarm", async () => {
    const dockerContainerSwarm = new DockerContainerSwarm("alpine-swarm", {
        alpineService: {
            Image: "alpine:latest",
            Cmd: [
                "sh",
                "-c",
                'while sleep 3600; do :; done'
            ]
        }
    }, 2);
    dockerContainerSwarm.start();
    await dockerContainerSwarm.waitReady();
    const containers = await dockerContainerSwarm.getContainers();
    expect(containers.filter(isContainerRunning).length).toBe(2);
    // Remove a container and see if service recreates the dead container 
    await containers[0].remove({ force: true });
    await setTimeout(1000);
    const containers2 = await dockerContainerSwarm.getContainers();
    expect(containers2.filter(isContainerRunning).length).toBe(2);
    dockerContainerSwarm.scale(3);
    await dockerContainerSwarm.waitReady();
    const containers3 = await dockerContainerSwarm.getContainers();
    expect(containers3.filter(isContainerRunning).length).toBe(3);

    dockerContainerSwarm.scale(1);
    await dockerContainerSwarm.waitReady();
    const containers4 = await dockerContainerSwarm.getContainers();
    expect(containers4.filter(isContainerRunning).length).toBe(1);
    
    await dockerContainerSwarm.stop();
    const containersEnd = await dockerContainerSwarm.getContainers();
    expect(containersEnd.length).toBe(0);
});


test("Scale a DockerContainerSwarm with a service", async () => {
    const dockerContainerSwarm = new DockerContainerSwarm("alpine-swarm", {
        alpineService: {
            Image: "alpine:latest",
            Cmd: [
                "sh",
                "-c",
                'while sleep 3600; do :; done'
            ]
        }
    }, 2);
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

    expect(await waitForTotalExecLoad(dockerContainerSwarm, 1)).toBe(1);

    dockerContainerSwarm.runOnSwarm(sleepCmd);
    await setTimeout(200);
    
    expect(await waitForTotalExecLoad(dockerContainerSwarm, 2)).toBe(2);

    for (let i = 0; i < 100; i++) {
        dockerContainerSwarm.runOnSwarm(sleepCmd);
    }

    expect(await waitForTotalExecLoad(dockerContainerSwarm, 102)).toBe(102);

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


test("Scale a DockerContainerSwarm with a service by exec", async () => {
    const dockerContainerSwarm = new DockerContainerSwarm("alpine-swarm", {
        alpineService: {
            Image: "alpine:latest",
            Cmd: [
                "sh",
                "-c",
                'while sleep 3600; do :; done'
            ]
        }
    }, 2);
    dockerContainerSwarm.start();
    await dockerContainerSwarm.waitReady();

    expect(await dockerContainerSwarm.getContainers()).toHaveLength(1);
    await setTimeout(200);

    const sleepCmd = [
        "sh",
        "-c",
        'while sleep 3600; do :; done'
    ];
    dockerContainerSwarm.runOnSwarm(sleepCmd);
    await setTimeout(200);

    expect(await waitForTotalExecLoad(dockerContainerSwarm, 1)).toBe(1);

    dockerContainerSwarm.runOnSwarm(sleepCmd);
    await setTimeout(200);

    expect(await waitForTotalExecLoad(dockerContainerSwarm,2)).toBe(2);
    expect(await dockerContainerSwarm.getContainers()).toHaveLength(2);

    await dockerContainerSwarm.stop();
    const containersEnd = await dockerContainerSwarm.getContainers();
    expect(containersEnd.length).toBe(0);
});