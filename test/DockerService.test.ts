import { DockerService, runExec, waitForTotalExecLoad} from "../lib";
import { randomUUID } from 'crypto';

jest.setTimeout(30000);

test("Container service", async () => {
    const uuid = randomUUID();
    const dockerService = new DockerService({
        Name: uuid,
        TaskTemplate: {
            ContainerSpec: {
                Image: "alpine:latest",
                Command: ["sh", "-c", 'while sleep 3600; do :; done']
            },
        },
        Mode: {
            Replicated: {
                Replicas: 4
            },
        },
    });
    await dockerService.start();
    await dockerService.waitReady(10000);
    const containers = await dockerService.getContainers();
    for (let i = 0; i < containers.length * 2; i++) {
        const container = containers[i % containers.length];
        runExec(container, ["sh", "-c", 'while sleep 3600; do :; done']).catch(console.error);
    }
    expect(await waitForTotalExecLoad(dockerService, 8)).toEqual(8);
    const execLoad = await dockerService.getExecLoad();
    for (const [containerId, load] of execLoad.entries()) {
        expect(load).toEqual(2);
    }
    await dockerService.remove();
    await dockerService.waitRemoved();
});