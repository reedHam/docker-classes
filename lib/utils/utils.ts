import { DockerContainerSwarm } from './../DockerContainerSwarm';
import { DockerService } from './../DockerService';
import Docker, { Container } from "dockerode";
import { setTimeout } from "timers/promises";
import stream from "stream";
import { getExecLoad } from './container.utils';

export const DOCKER_CONN = new Docker({
    socketPath: process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock",
});

export async function promiseSyncFn<T>(functionToTry: () => Promise<T> | T) {
    const res = functionToTry();
    if (res instanceof Promise) {
        return await res;
    } else {
        return Promise.resolve(res);
    }
}

export async function waitUntil<T>(
    conditionFn: () => Promise<T> | T,
    option?: {
        timeout?: number | 5000,
        interval?: number | 200,
    }
) {
    const { timeout = 5000, interval = 200 } = option || {};
    const start = Date.now();
    let result = await conditionFn();
    do {
        if (result) return result;
        await setTimeout(interval);
        result = await conditionFn();
    } while (Date.now() - start < timeout);
    return result;
}

export async function tryUntil<T>(
    functionToTry: () => Promise<T> | T,
    option?: {
        timeout?: number | 5000,
        interval?: number | 200,
    }
): Promise<T> {
    const { timeout = 5000, interval = 200 } = option || {};
    const start = Date.now();
    while (true) {
        try {
            return await promiseSyncFn(functionToTry);
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

export const execIsRunning = (execInspect: Docker.ExecInspectInfo) => execInspect.Running;

export async function pullImage(name: string) {
    return resolveDockerStream<{ status: string }>(
        (await DOCKER_CONN.pull(name)) as NodeJS.ReadableStream
    );
}

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

export async function waitForTotalExecLoad(target: DockerService | DockerContainerSwarm | Container[], load: number) {
    let totalLoad = 0;
    const getTotalExecLoad = async (): Promise<number> => {
        let execs: Awaited<ReturnType<typeof getExecLoad>>;
        if (target instanceof DockerService || target instanceof DockerContainerSwarm) {
            execs = await target.getExecLoad();
        } else {
            execs = await getExecLoad(target);
        }
        totalLoad = Array.from(execs.entries()).reduce((acc, [, exec]) => acc + exec, 0);
        return totalLoad;
    };
    await waitUntil(async () => await getTotalExecLoad() === load);
    return totalLoad;
}