import { DockerNetwork } from "./DockerNetwork";
import Docker, { Network } from "dockerode";
import { execIsRunning, getExecLoad, getMinimumLoadContainer, runExec, runExecStream } from "./utils";
import crypto from "crypto";
import { setTimeout } from "timers/promises";

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


/**
 * DockerContainerSwarm manages a collection of containers for running commands on.
 * This class should be used when the normal docker service does not provide enough
 * customization when scaling the service.
 */
export class DockerContainerSwarm {
    name: string;
    services;
    replicas;
    running: boolean;
    pollingInterval: number;
    execPerContainer: number;

    constructor(
        swarmName: string,
        replicas: number,
        services: { [name: string]: Docker.ContainerCreateOptions },
        options?: {
            pollingInterval?: number;
            execPerContainer?: number;
        }
    ) {
        this.name = swarmName;
        this.replicas = replicas;
        this.services = services;
        this.running = false;
        this.pollingInterval = options?.pollingInterval || 1000;
        this.execPerContainer = options?.execPerContainer || 0;
    }

    async start() {
        const serviceNames = Object.keys(this.services);

        this.running = true;
        while (this.running) {
            const replicasPerService = Math.ceil(
                this.replicas / serviceNames.length
            );
            await Promise.all(
                serviceNames.map(async (serviceName) => {
                    const containers = await this.getContainers(serviceName);
                    const runningContainers = containers.filter(async (c) => {
                        const info = await c.inspect();
                        return info.State.Running;
                    });

                    const countMismatch = replicasPerService - runningContainers.length;
                    let additionCount = countMismatch;
                    if (this.execPerContainer > 0 && countMismatch > 0) {
                        additionCount = 1;
                        for (const container of runningContainers) {
                            const execPerContainerMap = await this.getExecLoad(
                                (execInspect) => {
                                    return execIsRunning(execInspect) && execInspect.ContainerID === container.id;
                                }
                            );
                            const totalExec = Array.from(execPerContainerMap.entries()).reduce((total, [, execCount]) => total + execCount, 0);
                            if (totalExec <= this.execPerContainer) {
                                additionCount = 0;
                            }
                        }
                    }


                    const promiseAdditionArray = [];
                    for (let i = 0; i < additionCount; i++) {
                        promiseAdditionArray.push(this.startServiceContainer(serviceName, this.services[serviceName]));
                    }
                    await Promise.all(promiseAdditionArray);

                    const promiseRemovalArray = [];
                    for (let i = 0; i > countMismatch; i--) {
                        const [container] = containers.splice(0, 1);
                        promiseRemovalArray.push(container.remove({ force: true }));
                    }
                    await Promise.all(promiseRemovalArray);
                })
            );
            await setTimeout(this.pollingInterval);
        }
        this.running = false;
    }

    async stop() {
        this.running = false;
        const containers = await this.getContainers();
        await Promise.all(containers.map((c) => c.remove({ force: true })));
    }

    scale(replicas: number) {
        this.replicas = replicas;
    }

    waitReady = () =>
        waitUntil(async () => {
            const containers = await this.getContainers();
            const runningContainers = containers.filter(async (c) => {
                const info = await c.inspect();
                return info.State.Running;
            });
            return runningContainers.length === this.replicas;
        }, 10000);

    async getContainers(serviceName?: string) {
        let containerInfoArray = [];
        if (
            serviceName &&
            Object.prototype.hasOwnProperty.call(this.services, serviceName)
        ) {
            containerInfoArray = await DOCKER_CONN.listContainers({
                all: true,
                filters: {
                    label: [`com.docker.swarm.service.name=${serviceName}`],
                },
            });
        } else {
            containerInfoArray = await DOCKER_CONN.listContainers({
                all: true,
                filters: {
                    label: [`com.docker.swarm.name=${this.name}`],
                },
            });
        }

        return containerInfoArray.map((containerInfo) => {
            const container = DOCKER_CONN.getContainer(containerInfo.Id);
            return container;
        });
    }


    async getExecLoad(
        filterFn: (
            execInspect: Docker.ExecInspectInfo
        ) => boolean | Promise<boolean> = execIsRunning
    ) {
        const containers = await this.getContainers();
        return getExecLoad(containers, filterFn);
    } 

    async getMinimumLoadContainer() {
        const containers = await this.getContainers();
        return getMinimumLoadContainer(containers);
    }

    async runOnSwarm(cmd: string[]) {
        const containers = await this.getContainers();
        const randomContainer = containers[Math.floor(Math.random() * containers.length)];
        return runExec(randomContainer, cmd);
    }

    createServiceContainer(
        serviceName: string,
        options: Docker.ContainerCreateOptions
    ) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const containerOptions = JSON.parse(
            JSON.stringify(options)
        ) as ContainerCreateOptions;
        containerOptions.name = containerOptions.name || `${serviceName}_${crypto.randomUUID()}`;
        containerOptions.Labels = {
            ...(containerOptions.Labels || {}),
            "com.docker.swarm.service.name": serviceName,
            "com.docker.swarm.name": this.name,
        };
        const dockerContainer = new DockerContainer(containerOptions);
        return dockerContainer;
    }

    async startServiceContainer(
        serviceName: string,
        options: Docker.ContainerCreateOptions,
    ) {
        const container = this.createServiceContainer(
            serviceName,
            options
        );
        await container.start();
        await container.waitReady();
        return container;
    }
}
