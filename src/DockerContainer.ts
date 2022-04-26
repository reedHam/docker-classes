import Docker from 'dockerode';
import {
    DOCKER_CONN,
    getContainerByName,
    isContainerReady,
    isContainerRunning
} from './lib';

export type DockerContainerOptions = {
    imageName: string;
    containerName?: string;
    dockerfile?: string;
    mounts?: Docker.HostConfig['Binds'];
    volumes?: Docker.ContainerCreateOptions['Volumes'];
    portBindings?: Docker.PortBinding[];
    readyFunction?: (...args: any[]) => Promise<any>;
    cmd?: Docker.ContainerCreateOptions['Cmd'];
};

export class DockerContainer {
    imageName;
    dockerfile;
    cmd;
    container: Docker.Container | null = null;
    containerName;
    mounts;
    volumes;
    portBindings: Docker.PortBinding[] | undefined;
    readyFunction;

    constructor(imageName: string, options: DockerContainerOptions) {
        this.imageName = options.imageName;
        this.dockerfile = options.dockerfile;
        this.containerName = options.containerName || imageName;
        this.mounts = options.mounts;
        this.volumes = options.volumes;
        this.readyFunction = options.readyFunction;
        this.portBindings = options.portBindings;
        this.cmd = options.cmd;
    }

    get image() {
        return DOCKER_CONN.getImage(this.imageName);
    }

    pullImage() {
        return DOCKER_CONN.pull(this.imageName);
    }

    async isReady(timeout?: number) {
        return this.container
            ? this.readyFunction
                ? this.readyFunction(this.container)
                : isContainerReady(this.container, timeout)
            : false;
    }

    async isRunning() {
        return this.container ? isContainerRunning(this.container) : false;
    }

    async getContainer() {
        return getContainerByName(this.containerName);
    }

    async getInfo() {
        return this.container ? await this.container.inspect() : null;
    }

    async createContainer() {
        this.container = await this.getContainer();
        if (!this.container) {
            this.container = await DOCKER_CONN.createContainer({
                Image: this.imageName,
                name: this.containerName,
                Volumes: this.volumes,
                HostConfig: {
                    Binds: this.mounts,
                    PortBindings: this.portBindings,
                },
                Cmd: this.cmd,
            });
        }
        return this.container;
    }

    async remove() {
        if (this.container) {
            return this.container.remove({ force: true });
        }
    }

    async start() {
        if (!this.image) {
            await this.pullImage();
        }

        if (!this.container) {
            await this.createContainer();
        }

        if (this.container) {
            await this.container.start();
        }
    }
}