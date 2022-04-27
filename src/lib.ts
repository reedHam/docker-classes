import 'dotenv/config';
import Docker from 'dockerode';
import { setTimeout } from 'timers/promises';


export const DOCKER_CONN = new Docker({
    socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
});

export function resolveDockerStream<T>(stream: NodeJS.ReadableStream) {
    return new Promise<T[]>((resolve, reject) => {
        DOCKER_CONN.modem.followProgress(stream, (err, res: T[]) => {
            if (err) {
                reject(err);
            }
            resolve(res);
        });
    });
}

export async function getContainerByName(name: string) {
    const [ containerInfo ] = await DOCKER_CONN.listContainers({
        all: true,
        filters: {
            name: [name]
        }
    }); 
    if (!containerInfo) return null; 
    return DOCKER_CONN.getContainer(containerInfo.Id);
}

export async function isContainerRunning(container: Docker.Container) {
    const containerInfo = await container.inspect();
    return !!containerInfo?.State.Running;
}

export async function waitUntil(callback: () => Promise<boolean>, timeout: number = 5000) {
    let totalWaitTime = 0;
    let interval = 100;
    while (totalWaitTime < timeout) {
        const isReady = await callback();
        if (isReady) {
            return true;
        }
        await setTimeout(interval);
        totalWaitTime += interval;
        interval += 100;
    }
    return false;
}

export async function isContainerReady(container: Docker.Container, timeout = 4000) {
    // Use container health check to check if container is ready
    // Integrate with retry and timeouts.
    const checkReady = async () => {
        const containerInfo = await container.inspect();
        return !!containerInfo?.State.Running && (!containerInfo?.State.Health || containerInfo.State.Health.Status === 'healthy');
    };

    return await waitUntil(checkReady, timeout);
}
