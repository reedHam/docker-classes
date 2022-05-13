import "dotenv/config";
import Docker, { Container } from "dockerode";
import { setTimeout } from "timers/promises";
import stream from "stream";
import path from "path";

export const DOCKER_CONN = new Docker({
    socketPath: process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock",
});

export function resolveDockerStream<T>(stream: NodeJS.ReadableStream) {
    return new Promise<T[]>((resolve, reject) => {
        DOCKER_CONN.modem.followProgress(stream, (err, res: T[]) => {
            if (err) {
                reject(err);
            }
            resolve(res);
        });
    });
}

export async function getContainerByName(name: string) {
    const [containerInfo] = await DOCKER_CONN.listContainers({
        all: true,
        filters: {
            name: [name],
        },
    });
    if (!containerInfo?.Id) return null;
    return DOCKER_CONN.getContainer(containerInfo.Id);
}

export async function getServiceByName(name: string) {
    const serviceInfos = await DOCKER_CONN.listServices();
    const serviceInfo = serviceInfos.find(
        (service) => service?.Spec?.Name === name
    );
    if (!serviceInfo?.ID) return null;
    return DOCKER_CONN.getService(serviceInfo.ID);
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

export async function isContainerRunning(container: Docker.Container) {
    const containerInfo = await container.inspect();
    return !!containerInfo?.State.Running;
}

export async function isContainerReady(
    container: Docker.Container,
    timeout = 4000
) {
    // Use container health check to check if container is ready
    // Integrate with retry and timeouts.
    const checkReady = async () => {
        const containerInfo = await container.inspect();
        return (
            !!containerInfo?.State.Running &&
            (!containerInfo?.State.Health ||
                containerInfo.State.Health.Status === "healthy")
        );
    };

    return waitUntil(checkReady, timeout);
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

    return waitUntil(checkReady, timeout);
}

export async function waitUntil(
    callback: () => Promise<boolean>,
    timeout = 5000,
    interval = 200
) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const isReady = await callback();
        if (isReady) {
            return true;
        }
        await setTimeout(interval);
    }
    return false;
}

export async function tryUntil<T>(
    functionToTry: () => Promise<T> | T,
    timeout = 5000,
    interval = 200
): Promise<T> {
    const start = Date.now();
    while (true) {
        try {
            const res = functionToTry();
            if (res instanceof Promise) {
                return await res;
            } else {
                return Promise.resolve(res);
            }
        } catch (e) {
            if (Date.now() - start > timeout) {
                throw e;
            }
            await setTimeout(interval);
        }
    }
}

export async function imageExists(name: string) {
    try {
        return (
            (await DOCKER_CONN.getImage(name).inspect()).RepoTags[0] ===
            (name.includes(":") ? name : name + ":latest")
        );
    } catch (e) {
        if (e instanceof Error) {
            if (e.message.includes("HTTP code 404")) {
                return false;
            }
        }
        throw e;
    }
}

export async function pullImage(name: string) {
    return resolveDockerStream<{ status: string }>(
        (await DOCKER_CONN.pull(name)) as NodeJS.ReadableStream
    );
}

enum STREAM_TYPE {
    STDIN = 0,
    STDOUT = 1,
    STDERR = 2,
}

/*
 * first 8 bytes are the header
 * stream type, 0, 0, 0, size1, size2, size3, size4
 * last 4 bytes are a uint32 encoded as big endian
 */
const parseStreamChunk = (buffer: Buffer) => {
    const dataArr = [];
    const errArray = [];

    while (buffer.length > 0) {
        const header = buffer.slice(0, 8);
        const type = header.readUInt8(0);
        const size = header.readUInt32BE(4);
        const data = buffer.slice(8, 8 + size);
        buffer = buffer.slice(8 + size);

        if (type === STREAM_TYPE.STDERR) {
            errArray.push(data);
        } else {
            dataArr.push(data);
        }
    }

    return [dataArr, errArray];
};

type StreamResponse = AsyncIterableIterator<
    [stdout: Buffer, stderr: null] | [stdout: null, stderr: Buffer]
>;

export async function* demuxDockerStream(
    stream: stream.Duplex
): StreamResponse {
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
        const [dataArr, errArr] = parseStreamChunk(buffer);
        for (const data of dataArr) {
            yield [data, null];
        }
        for (const err of errArr) {
            yield [null, err];
        }
    }
}

export async function runExec(container: Container, cmd: string[]) {
    const execProcess = await container.exec({
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
    });
    const execProcessStream = await execProcess.start({});

    const stdOut: Buffer[] = [];
    const stdErr: Buffer[] = [];
    for await (const [data, err] of demuxDockerStream(execProcessStream)) {
        data && stdOut.push(data);
        err && stdErr.push(err);
    }

    return [
        Buffer.concat(stdOut).toString(),
        Buffer.concat(stdErr).toString(),
    ] as [stdOut: string, stdErr: string];
}

export async function* runExecStream(container: Container, cmd: string[]) {
    const execProcess = await container.exec({
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
    });
    const execProcessStream = await execProcess.start({});
    for await (const [data, err] of demuxDockerStream(execProcessStream)) {
        yield [data, err];
    }
}

export async function runExecFile(
    container: Container,
    cmd: string,
    file: string,
    directory = "/"
) {
    const filePath = path.join(directory, file);
    const cmdWithFile = ["sh", "-c", `${cmd} 2>&1 > ${filePath}`];
    const execProcess = await container.exec({
        Cmd: cmdWithFile,
        AttachStdout: false,
        AttachStderr: false,
    });
    await execProcess.start({});
    return filePath;
}
