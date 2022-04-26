import 'dotenv/config';
import Docker from 'dockerode';

export const DOCKER_CONN = new Docker({
    socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
});

export async function getContainerByName(name: string) {
    const [ containerInfo ] = await DOCKER_CONN.listContainers({
        all: true,
        filters: {
            name: [name]
        }
    }); 

    return DOCKER_CONN.getContainer(containerInfo.Id); 
}

export async function isContainerRunning(container: Docker.Container) {
    const containerInfo = await container.inspect();
    return !!containerInfo?.State.Running;
}

export async function isContainerReady(container: Docker.Container, timeout?: number) {
    // Use container health check to check if container is ready
    // Integrate with retry and timeouts.
    const containerInfo = await container.inspect();
    return !!containerInfo?.State.Running && !!containerInfo?.State.Health;
}

