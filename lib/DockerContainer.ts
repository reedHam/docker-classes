import { DockerNetwork } from './DockerNetwork';
import Docker, { Network } from 'dockerode';
import { runExec, runExecStream } from './utils';


import {
    DOCKER_CONN,
    getContainerByName,
    imageExists,
    isContainerReady,
    isContainerRunning,
    pullImage,
    waitUntil
} from './utils';

export type DockerContainerOptions = {
    containerName?: string;
    dockerfile?: string;
    mounts?: Docker.HostConfig['Binds'];
    volumes?: Docker.ContainerCreateOptions['Volumes'];
    portBindings?: Docker.HostConfig['PortBindings'];
    readyFunction?: (...args: any[]) => Promise<any>;
    cmd?: Docker.ContainerCreateOptions['Cmd'];
};

export class DockerContainer {
    imageName;
    dockerfile;
    cmd;
    container: Docker.Container | null = null;
    image: Docker.Image;
    name;
    mounts;
    volumes;
    portBindings: Docker.PortBinding[] | undefined;
    readyFunction;

    constructor(imageName: string, options?: DockerContainerOptions) {
        if (!imageName) throw new Error('imageName is required');
        this.imageName = imageName;
        this.image = DOCKER_CONN.getImage(this.imageName);
        this.dockerfile = options?.dockerfile;
        this.name = options?.containerName || imageName.split(':')[0];
        this.mounts = options?.mounts;
        this.volumes = options?.volumes;
        this.readyFunction = options?.readyFunction;
        this.portBindings = options?.portBindings;
        this.cmd = options?.cmd;
    }

    async waitReady(timeout?: number) {
        if (this.container) {
            if (this.readyFunction) {
                return this.readyFunction(this.container);
            } else {
                return isContainerReady(this.container, timeout);
            }
        }
        throw new Error('Container not found while trying to check if its ready');
    }

    async waitRemoved(timeout = 5000) {
        if (this.container) {
            await waitUntil(async () => {
                try {
                    await this.getInfo();
                    return false;
                } catch (e) {
                    if (e instanceof Error && e.message.includes('404')) {
                        return true;
                    }
                    throw e;
                }
            }, timeout);
        }
    }

    async isRunning() {
        return this.container ? isContainerRunning(this.container) : false;
    }

    async getContainer() {
        const container = await getContainerByName(this.name);
  
        if (container) {
            this.container = container;
            return this.container;
        } else {
            return null;
        }
    }

    async getInfo() {
        if (!this.container) this.container = await this.getContainer();
        return this.container ? await this.container.inspect() : null;
    }

    async createContainer() {
        this.container = await this.getContainer();
        if (!this.container) {
            this.container = await DOCKER_CONN.createContainer({
                Image: this.imageName,
                name: this.name,
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

    async connectToNetwork(network: string | Network) {
        if (typeof network === 'string') {
            const networkReturn = await DockerNetwork.getNetwork(network);
            if (!networkReturn) throw new Error(`Network ${network} not found`);
            network = networkReturn;
        }
        
        if (network && this.container) {
            await network.connect(this.container);
        } else if (!network) {
            throw new Error(`Network not found while trying to connect to it: ${this.name}`);
        } else if (!this.container) {
            throw new Error(`Container not found while trying to connect to network: ${network} ${this.name}`);
        }
    }

    async remove() {
        if (this.container) {
            return this.container.remove({ force: true });
        } else {
            throw new Error('Container not found while trying to remove');
        }
    }

    async start() {
        if (!await imageExists(this.imageName)) {
            await pullImage(this.imageName);
        }
        
        if (!await this.getContainer()) {
            await this.createContainer();
        }

        if (this.container) {
            try {
                await this.container.start();
            } catch (e) {
                if (e instanceof Error && e.message.includes('304')) {
                    return;
                }
                throw e;
            }
        } else {
            throw new Error('Container not found while trying to start');
        }
    }

    async runExec(cmd: string[]) {
        if (this.container) {
            return runExec(this.container, cmd);
        } else {
            throw new Error('Container not found while trying to run exec');
        }
    }

    async execStream(cmd: string[]) {
        if (this.container) {
            return runExecStream(this.container, cmd);
        } else {
            throw new Error('Container not found while trying to run exec');
        }
    }
}


