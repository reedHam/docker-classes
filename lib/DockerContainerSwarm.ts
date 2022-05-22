import { ContainerCreateOptions, DockerContainer } from "./DockerContainer";
import Docker from "dockerode";
import crypto from "crypto";
import { setTimeout } from "timers/promises";
import {
    execIsRunning,
    promiseSyncFn,
    DOCKER_CONN,
    getExecLoad,
    getMinimumLoadContainer,
    runExec,
    DockerContainerSwarmReadyFunction,
    DockerContainerSwarmScalingFunction,
    maximumReplicasSwarmReady,
    maximumReplicasSwarmScaling,
    tryUntil
} from "./utils";

export interface SwarmContainerCreateOptions extends Docker.ContainerCreateOptions {
    Image: string;
}

/**
 * DockerContainerSwarm manages a collection of containers for running commands on.
 * This class should be used when the normal docker service does not provide enough
 * customization when scaling the service. 
 * 
 * The best use case for this class is when you want to run a command on a set of 
 * services that are identical aside from some environment. 
 * 
 * The problem it was designed to solve was scaling a pool of vpn clients that are
 * identical aside from location or provider.
 */
export class DockerContainerSwarm {
    name: string;
    services;
    running: boolean;
    pollingInterval: number;
    scalingFunction: DockerContainerSwarmScalingFunction;
    readyFunction: DockerContainerSwarmReadyFunction;
    maxReplicas: number;

    /**
     * Creates a new DockerContainerSwarm
     * @param swarmName The name of the swarm
     * @param services The services to run in the swarm
     * @param options.pollingInterval The interval at witch the scalling function will be called (defaults to 1000). 
     * Will wait for scaling function to complete before calling again.
     * @param options.scalingFunction Function that handles creating and removing containers should not create more than maxReplicas number of containers.
     * @param options.readyFunction Function that handles checking if the containers are ready (defaults to MaximumReplicasSwarmReadyFunction).
     */
    constructor(
        swarmName: string,
        services: { [name: string]: SwarmContainerCreateOptions },
        maxReplicas: number,
        options?: {
            scalingInterval?: 1000;
            scalingFunction?: DockerContainerSwarmScalingFunction,
            readyFunction?: DockerContainerSwarmReadyFunction,
        }
    ) {
        this.name = swarmName;
        this.services = services;
        this.running = false;
        this.pollingInterval = options?.scalingInterval || 1000;
        this.maxReplicas = maxReplicas;
        this.scalingFunction = options?.scalingFunction || maximumReplicasSwarmScaling;
        this.readyFunction = options?.readyFunction || maximumReplicasSwarmReady;
    }

    async start() {
        this.running = true;
        while (this.running) {
            await promiseSyncFn(this.scalingFunction.bind(null, this))
            await setTimeout(this.pollingInterval);
        }
        this.running = false;
    }

    waitReady() {
        return this.readyFunction(this);
    }

    async stop() {
        this.running = false;
        const containers = await this.getContainers();
        await Promise.all(containers.map((c) => c.remove({ force: true })));
    }

    scale(replicas: number) {
        this.maxReplicas = replicas;
    }

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

    createServiceContainer(serviceName: string) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const containerOptions = Object.assign({}, this.services[serviceName]) as ContainerCreateOptions;
        containerOptions.name = containerOptions.name || `${serviceName}_${crypto.randomUUID()}`;
        containerOptions.Labels = {
            ...(containerOptions.Labels || {}),
            "com.docker.swarm.service.name": serviceName,
            "com.docker.swarm.name": this.name,
        };
        const dockerContainer = new DockerContainer(containerOptions);
        return dockerContainer;
    }

    async startServiceContainer(serviceName: string, retries = 0): Promise<DockerContainer> {
        try {
            const container = this.createServiceContainer(serviceName);
            await container.start();
            await container.waitReady();
            return container;
        } catch (e) {
            if (
                e instanceof Error
                && e.message.toUpperCase().includes("HTTP CODE 409")
                && e.message.toLowerCase().includes("already in use")
                && retries < 3) {
                return this.startServiceContainer(serviceName, retries + 1);
            }
            throw e;
        }
    }
}


