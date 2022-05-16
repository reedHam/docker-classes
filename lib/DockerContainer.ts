import { DockerNetwork } from "./DockerNetwork";
import Docker, { Network } from "dockerode";
import { runExec, runExecStream } from "./utils";

import {
    DOCKER_CONN,
    getContainerByName,
    imageExists,
    isContainerReady,
    isContainerRunning,
    pullImage,
    waitUntil,
} from "./utils";

export interface ContainerCreateOptions extends Docker.ContainerCreateOptions {
    Image: string;
    name: string;
}

export class DockerContainer {
    options;
    name;
    container: Docker.Container | null = null;
    readyFunction;

    constructor(
        options: ContainerCreateOptions,
        readyFunction?: (service: Docker.Container) => Promise<boolean>
    ) {
        this.options = options;
        this.name = options.name;
        this.readyFunction = readyFunction;
    }

    async createContainer() {
        this.container = await this.getContainer();
        if (!this.container) {
            this.container = await DOCKER_CONN.createContainer(this.options);
        }
        return this.container;
    }

    async start() {
        if (!(await imageExists(this.options.Image))) {
            await pullImage(this.options.Image);
        }

        if (!(await this.getContainer())) {
            await this.createContainer();
        }

        if (this.container) {
            try {
                await this.container.start();
            } catch (e) {
                if (e instanceof Error && e.message.includes("304")) {
                    return;
                }
                throw e;
            }
        } else {
            throw new Error("Container not found while trying to start");
        }
    }

    async waitReady(timeout?: number) {
        if (this.container) {
            if (this.readyFunction) {
                return this.readyFunction(this.container);
            } else {
                return isContainerReady(this.container, timeout);
            }
        }
        throw new Error(
            "Container not found while trying to check if its ready"
        );
    }

    async waitRemoved(timeout = 5000) {
        if (this.container) {
            await waitUntil(async () => {
                try {
                    await this.getInfo();
                    return false;
                } catch (e) {
                    if (e instanceof Error && e.message.includes("404")) {
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

    async connectToNetwork(network: string | Network) {
        if (typeof network === "string") {
            const networkReturn = await DockerNetwork.getNetwork(network);
            if (!networkReturn) throw new Error(`Network ${network} not found`);
            network = networkReturn;
        }

        if (network && this.container) {
            try {
                await network.connect({
                    Container: this.container.id,
                });
            } catch (e) {
                if (
                    e instanceof Error &&
                    (e.message.includes("304") || e.message.includes("409"))
                ) {
                    return;
                }
                throw e;
            }
        } else if (!network) {
            throw new Error(
                `Network not found while trying to connect to it: ${this.name}`
            );
        } else if (!this.container) {
            throw new Error(
                `Container not found while trying to connect to network: ${network.id} ${this.name}`
            );
        }
    }

    async remove() {
        if (this.container) {
            return this.container.remove({ force: true });
        } else {
            throw new Error("Container not found while trying to remove");
        }
    }

    async exec(cmd: string[]) {
        if (this.container) {
            return runExec(this.container, cmd);
        } else {
            throw new Error("Container not found while trying to run exec");
        }
    }

    execStream(cmd: string[]) {
        if (this.container) {
            return runExecStream(this.container, cmd);
        } else {
            throw new Error("Container not found while trying to run exec");
        }
    }
}
