import type { DockerContainerSwarm } from "../DockerContainerSwarm";
import { getContainerByName, getExecLoad, getMinimumLoadContainer, isContainerRunning } from "./container.utils";
import { DOCKER_CONN, totalExecLoad, tryUntil, waitUntil } from "./utils";

export type DockerContainerSwarmScalingFunction = (swarm: DockerContainerSwarm) => Promise<void> | void;
export type DockerContainerSwarmReadyFunction = (swarm: DockerContainerSwarm) => Promise<boolean> | boolean;

/**
 * Waits until the total number of containers in the swarm is equal to the maximum number of containers.
 * @param swarm DockerContainerSwarm
 * @param options.timeout Timeout in milliseconds
 * @returns true if the service is ready, false if the timeout is reached
 */
export async function maximumReplicasSwarmReady(swarm: DockerContainerSwarm, options?: { timeout?: number | 10000 }): Promise<boolean> {
    const { timeout = 10000 } = options || {};
    return tryUntil(async () => {
        const containers = await swarm.getContainers();
        const runningContainers = containers.filter(async (c) => {
            const info = await c.inspect();
            return info.State.Running;
        });
        const serviceNames = Object.keys(swarm.services);
        if (runningContainers.length !== Math.ceil(swarm.maxReplicas / serviceNames.length) * serviceNames.length) {
            throw new Error("Not ready");
        }
        return true;
    }, { timeout });
}

/** 
 * Scales the swarm to the maximum number of replicas divided among the services.
 * @param swarm DockerContainerSwarm
 */
export async function maximumReplicasSwarmScaling(swarm: DockerContainerSwarm): Promise<void> {
    const serviceNames = Object.keys(swarm.services);
    const maxServiceReplicas = Math.ceil(swarm.maxReplicas / serviceNames.length);

    for (const serviceName of serviceNames) {
        const containers = await swarm.getContainers(serviceName);
        const runningContainers = containers.filter(isContainerRunning);
        const numContainers = runningContainers.length;
        const countMismatch = maxServiceReplicas - numContainers;

        if (countMismatch > 0) {
            const createPromises = [];
            for (let i = 0; i < countMismatch; i++) {
                createPromises.push(swarm.startServiceContainer(serviceName));
            }
            await Promise.all(createPromises); 
        } else if (countMismatch < 0) {
            const removePromises = [];
            for (let i = 0; i > countMismatch && runningContainers.length > 0; i--) {
                const container = await getMinimumLoadContainer(runningContainers);
                if (!container) break;
                const index = runningContainers.indexOf(container);
                if (index > -1) runningContainers.splice(index, 1);
                removePromises.push(container.remove({ force: true }));
            }
            await Promise.all(removePromises);
        }
    }
}


/**
 * Waits until there is a single container running on the swarm for each service.
 * @param swarm DockerContainerSwarm
 */
export async function singleContainerSwarmReady(swarm: DockerContainerSwarm): Promise<boolean> {
    const serviceNames = Object.keys(swarm.services);
    return tryUntil(async () => {
        for (const serviceName of serviceNames) {
            const containers = await swarm.getContainers(serviceName);
            const runningContainers = containers.filter(isContainerRunning);
            if (runningContainers.length < 1) {
                throw new Error("Not ready");
            }
        }
        return true;
    });
}


/**
 * Scales the swarm services based on a threshold of exec load.
 * @param threshold The threshold of exec load to start a new container
 */
export function createExecContainerSwarmScaling(threshold: number): DockerContainerSwarmScalingFunction {
    return async (swarm: DockerContainerSwarm) => {
        const serviceNames = Object.keys(swarm.services);
        const maxServiceReplicas = Math.ceil(swarm.maxReplicas / serviceNames.length);

        const containerPromises = [];
        for (const serviceName of serviceNames) {
            const runningContainers = (await swarm.getContainers(serviceName)).filter(isContainerRunning);
            if (runningContainers.length === 0) {
                containerPromises.push(swarm.startServiceContainer(serviceName));
            } else {
                const execLoad = await getExecLoad(runningContainers)
                for (const [id, load] of execLoad) {
                    if (load >= threshold && runningContainers.length < maxServiceReplicas) {
                        containerPromises.push(swarm.startServiceContainer(serviceName));
                    } else if (load === 0 && runningContainers.length > 1) {
                        const index = runningContainers.findIndex((c) => c.id === id);
                        if (index > -1) runningContainers.splice(index, 1);
                        containerPromises.push(DOCKER_CONN.getContainer(id).remove({ force: true }));
                    }
                }
            }
        }
        await Promise.all(containerPromises);
    };
}