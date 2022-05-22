import type { DockerContainerSwarm } from "../DockerContainerSwarm";
import { getMinimumLoadContainer } from "./container.utils";
import { tryUntil, waitUntil } from "./utils";

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
        if (runningContainers.length !== Math.ceil(swarm.maxReplicas / Object.keys(swarm.services).length) * Object.keys(swarm.services).length) {
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
        const runningContainers = containers.filter(async (c) => {
            const info = await c.inspect();
            return info.State.Running;
        });
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
