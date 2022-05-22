import Docker from "dockerode";
import type { Container } from "dockerode";
import { demuxDockerStream, DOCKER_CONN, waitUntil } from "./utils";
import path from "path";

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

export function isContainerReady(
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

    return waitUntil(checkReady, { timeout });
}

export async function isContainerRunning(container: Docker.Container) {
    const containerInfo = await container.inspect();
    return !!containerInfo?.State.Running;
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

    return {
        stdOut: Buffer.concat(stdOut).toString(),
        stdErr: Buffer.concat(stdErr).toString(),
        exec: execProcess,
    }
}

export async function* runExecStream(container: Container, cmd: string[]) {
    const execProcess = await container.exec({
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
    });
    const execProcessStream = await execProcess.start({});
    for await (const [stdOut, stdErr] of demuxDockerStream(execProcessStream)) {
        yield {
            stdOut,
            stdErr,
        };
    }
}

export async function runExecFile(
    container: Container,
    cmd: string,
    file: string,
    directory = "/",
    options?: {
        append: boolean;
    }
) {
    const filePath = path.join(directory, file);
    const cmdWithFile = [
        "sh",
        "-c",
        `${cmd} ${options?.append ? ">>" : ">"} ${filePath} 2>&1`,
    ];
    const execProcess = await container.exec({
        Cmd: cmdWithFile,
        AttachStdout: false,
        AttachStderr: false,
    });
    await execProcess.start({});
    return filePath;
}

export async function getExecLoad(
    containers: Container[],
    filterFn: (
        execInspect: Docker.ExecInspectInfo
    ) => boolean | Promise<boolean> = (execInspect) => execInspect.Running ) {
    const loadMap = new Map<string, number>();
    for (const container of containers) {
        loadMap.set(container.id, 0);
    }
    await Promise.all(
        containers.map(async (container) => {
            const { ExecIDs } = await container.inspect();
            return ExecIDs
                ? await Promise.all(
                        ExecIDs.map(async (id) => {
                            const exec = DOCKER_CONN.getExec(id);
                            const execInspect = await exec.inspect();
                            let filterResult = filterFn(execInspect);
                            if (filterResult instanceof Promise) {
                                filterResult = await filterResult;
                            }
                            if (filterResult) {
                                loadMap.set(
                                    container.id,
                                    (loadMap.get(container.id) || 0) + 1
                                );
                            }
                        })
                    )
                : [];
        })
    );
    return loadMap;
}

export async function getMinimumLoadContainer(containers: Container[]) {
    const loadMap = await getExecLoad(containers);
    let minLoad = Infinity;
    let minLoadContainer: Container | undefined;
    for (const [containerId, load] of loadMap) {
        if (load === minLoad) {
            minLoadContainer = Math.random() < 0.5 ? minLoadContainer : containers.find((container) => container.id === containerId);
        } else if (load < minLoad) {
            minLoad = load;
            minLoadContainer = containers.find((container) => container.id === containerId);
        }
    }
    return minLoadContainer;
}
