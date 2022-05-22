import Docker from "dockerode";
import { DockerContainerSwarm } from "../DockerContainerSwarm";
import { getMinimumLoadContainer } from "./container.utils";
import { waitUntil } from "./utils";

export type DockerContainerSwarmScalingFunction = (swarm: DockerContainerSwarm) => Promise<void> | void;
export type DockerContainerSwarmReadyFunction = (swarm: DockerContainerSwarm) => Promise<boolean> | boolean;

/**
 * Waits until the total number of containers in the swarm is equal to the maximum number of containers.
 * @param swarm DockerContainerSwarm
 * @param options.timeout Timeout in milliseconds
 * @returns true if the service is ready, false if the timeout is reached
 */
export function maximumReplicasSwarmReady(swarm: DockerContainerSwarm, options?: { timeout: 10000 }): Promise<boolean> {
    return waitUntil(async () => {
            const containers = await swarm.getContainers();
            const runningContainers = containers.filter(async (c) => {
                const info = await c.inspect();
                return info.State.Running;
            });
            return runningContainers.length >= swarm.maxReplicas;
    }, options?.timeout || 10000);
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
                const container = getMinimumLoadContainer(runningContainers);
                removePromises.push(container.remove({ force: true }));
            }
            await Promise.all(removePromises);
        }
    }
}