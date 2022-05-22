import { DockerContainerSwarm, createExecContainerSwarmScaling, isContainerRunning, singleContainerSwarmReady, waitForTotalExecLoad } from "../lib";
import { setTimeout } from 'timers/promises';

jest.setTimeout(60000);

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
    expect(dockerContainerSwarm.running).toBe(false);
    expect(await dockerContainerSwarm.getContainers()).toHaveLength(0);
    await setTimeout(2000);
    expect(await dockerContainerSwarm.getContainers()).toHaveLength(0);
});


test("Runs exec on swarm", async () => {
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
        'sleep 5'
    ];
    dockerContainerSwarm.runOnSwarm(sleepCmd);
    await setTimeout(200);

    expect(await waitForTotalExecLoad(dockerContainerSwarm, 1)).toBe(1);

    dockerContainerSwarm.runOnSwarm(sleepCmd);
    await setTimeout(200);
    
    expect(await waitForTotalExecLoad(dockerContainerSwarm, 2)).toBe(2);

    const jobCount = 100;
    for (let i = 0; i < jobCount; i++) {
        dockerContainerSwarm.runOnSwarm(sleepCmd);
    }

    expect(await waitForTotalExecLoad(dockerContainerSwarm, jobCount + 2)).toBe(jobCount + 2);

    const execLoad = await dockerContainerSwarm.getExecLoad();
    const loadArr = Array.from(execLoad.entries());
    const containerCount = Array.from(execLoad.keys()).length;
    const errorTolerance = jobCount * 0.1;
    const lowThreshold = (jobCount / containerCount) - errorTolerance;
    const highThreshold = (jobCount / containerCount) + errorTolerance;
    expect(loadArr[0][1]).toBeGreaterThanOrEqual(lowThreshold);
    expect(loadArr[0][1]).toBeLessThanOrEqual(highThreshold);
    expect(loadArr[1][1]).toBeGreaterThanOrEqual(lowThreshold);
    expect(loadArr[1][1]).toBeLessThanOrEqual(highThreshold);

    await setTimeout(5 * 1000);
    expect(await waitForTotalExecLoad(dockerContainerSwarm, 0)).toBe(0);

    await dockerContainerSwarm.stop();
    expect(dockerContainerSwarm.running).toBe(false);
    expect(await dockerContainerSwarm.getContainers()).toHaveLength(0);
    await setTimeout(3000);
    expect(await dockerContainerSwarm.getContainers()).toHaveLength(0);
});

test("Scale a DockerContainerSwarm by exec", async () => {
    const dockerContainerSwarm = new DockerContainerSwarm("alpine-swarm", {
        alpineService: {
            Image: "alpine:latest",
            Cmd: [
                "sh",
                "-c",
                'while sleep 3600; do :; done'
            ]
        }
    },
        2,
        {
            scalingFunction: createExecContainerSwarmScaling(1),
            readyFunction: singleContainerSwarmReady,
        }
    );
    dockerContainerSwarm.start();
    await dockerContainerSwarm.waitReady();

    expect(await dockerContainerSwarm.getContainers()).toHaveLength(1);

    const sleepCmd = [
        "sh",
        "-c",
        'sleep 5'
    ];
 
    let jobCount = 0;
    const runCmdOnSwarm = async (expectedContainerCount: number) => {
        dockerContainerSwarm.runOnSwarm(sleepCmd);
        jobCount++;
        expect(await waitForTotalExecLoad(dockerContainerSwarm, jobCount)).toBe(jobCount);
        expect(await dockerContainerSwarm.getContainers()).toHaveLength(expectedContainerCount);
    }

    await runCmdOnSwarm(1);
    await runCmdOnSwarm(2);
    await runCmdOnSwarm(2);
    await runCmdOnSwarm(2);

    const execLoad = await dockerContainerSwarm.getExecLoad();
    const loadArr = Array.from(execLoad.entries());
    const containerCount = Array.from(execLoad.keys()).length;
    const errorTolerance = jobCount * 0.1;
    const lowThreshold = Math.ceil((jobCount / containerCount) - errorTolerance);
    const highThreshold = Math.ceil((jobCount / containerCount) + errorTolerance);
    for (const [containerId, load] of loadArr) {
        expect(load).toBeGreaterThanOrEqual(lowThreshold);
        expect(load).toBeLessThanOrEqual(highThreshold);
    }
    
    await setTimeout(7 * 1000);
    expect(await waitForTotalExecLoad(dockerContainerSwarm, 0)).toBe(0);
    expect(await dockerContainerSwarm.getContainers()).toHaveLength(1);

    await dockerContainerSwarm.stop();
    expect(dockerContainerSwarm.running).toBe(false);
    expect(await dockerContainerSwarm.getContainers()).toHaveLength(0);
    await setTimeout(2000);
    expect(await dockerContainerSwarm.getContainers()).toHaveLength(0);
});