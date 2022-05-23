import type { DockerService } from "./../DockerService";
import Docker from "dockerode";
import { DOCKER_CONN, waitUntil } from "./utils";

export async function getServiceByName(name: string) {
    const serviceInfos = await DOCKER_CONN.listServices();
    const serviceInfo = serviceInfos.find(
        (service) => service?.Spec?.Name === name
    );
    if (!serviceInfo?.ID) return null;
    return DOCKER_CONN.getService(serviceInfo.ID);
}

export async function isServiceReady(service: Docker.Service, timeout = 4000) {
    const serviceInfo = await service.inspect();
    if (!serviceInfo) throw new Error("Service not found");
    const checkReady = async () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const tasks: ListTaskReturn[] = await DOCKER_CONN.listTasks({
            filters: {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                service: [serviceInfo.Spec.Name],
            },
        });

        return tasks
            .filter((task) => task?.Status?.State !== "rejected")
            .every((task) => task?.Status?.State === "running");
    };

    return waitUntil(checkReady, { timeout });
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
        };
    };
    DesiredState: string;
};

export async function getServiceContainers(service: Docker.Service) {
    const serviceInfo = await service.inspect();
    if (!serviceInfo) throw new Error("Service not found");

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const tasks: ListTaskReturn[] = await DOCKER_CONN.listTasks({
        filters: {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            service: [serviceInfo.Spec.Name],
        },
    });

    const containerIDs = tasks
        .filter(
            (task) =>
                task?.Status?.ContainerStatus?.ContainerID &&
                task?.Status?.ContainerStatus?.ContainerID?.length > 0 &&
                task?.Status?.State === "running"
        )
        .map((task) => task?.Status?.ContainerStatus?.ContainerID);
    return Promise.all(
        containerIDs.map((containerID) => DOCKER_CONN.getContainer(containerID))
    );
}
