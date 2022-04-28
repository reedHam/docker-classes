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
    if (!containerInfo?.Id) return null; 
    return DOCKER_CONN.getContainer(containerInfo.Id);
}

export async function getServiceByName(name: string) {
    const [ serviceInfo ] = await DOCKER_CONN.listServices({
        Filters: {
            name: [name]
        }
    });
    if (!serviceInfo?.ID) return null;
    return DOCKER_CONN.getService(serviceInfo.ID);
}


export type ListTaskReturn = {
    ID: string;
    Status: {
        Timestamp: string;
        State: string;
        Message: string;
        ContainerStatus: {
            ContainerID: string;
            PID: number;
        }
    }
    DesiredState: string;
}

export async function getServiceContainers(service: Docker.Service) {
    const serviceInfo = await service.inspect();
    if (!serviceInfo) throw new Error('Service not found');
    
    const tasks: ListTaskReturn[] = await DOCKER_CONN.listTasks({
        filters: {
            service: [serviceInfo.Spec.Name]
        }
    });

    const containerIDs = tasks.map(task => task.Status.ContainerStatus.ContainerID);
    return Promise.all(containerIDs.map(containerID => DOCKER_CONN.getContainer(containerID)));
}

export async function isContainerRunning(container: Docker.Container) {
    const containerInfo = await container.inspect();
    return !!containerInfo?.State.Running;
}

export async function isContainerReady(container: Docker.Container, timeout = 4000) {
    // Use container health check to check if container is ready
    // Integrate with retry and timeouts.
    const checkReady = async () => {
        const containerInfo = await container.inspect();
        return !!containerInfo?.State.Running && (!containerInfo?.State.Health || containerInfo.State.Health.Status === 'healthy');
    };

    return waitUntil(checkReady, timeout);
}

export async function isServiceReady(service: Docker.Service, timeout = 4000) {
    const checkReady = async () => {
        const containers = await getServiceContainers(service);
        return (await Promise.all(containers.map(container => isContainerReady(container))))
            .every(isReady => isReady);
    };

    return waitUntil(checkReady, timeout);
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

export async function imageExists(name: string) {
    try {
        return (await DOCKER_CONN.getImage(name).inspect()).RepoTags[0] === (name.includes(':') ? name : name + ':latest');
    } catch (e) {
        if (e instanceof Error) {
            if (e.message.includes('HTTP code 404')) {
                return false;
            } 
        }
        throw e;
    }
}

export async function pullImage(name: string) {
    return resolveDockerStream<{ status: string }>(await DOCKER_CONN.pull(name) as NodeJS.ReadableStream);
}
