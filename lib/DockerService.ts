import Docker from "dockerode";
import { getExecLoad } from "./utils/container.utils";
import { getServiceByName, getServiceContainers, isServiceReady } from "./utils/service.utils";
import { DOCKER_CONN, tryUntil, imageExists, pullImage} from "./utils/utils";


interface containerSpec extends Docker.ContainerSpec {
    Image: string;
}

interface taskTemplate {
    ContainerSpec: containerSpec;
}

interface serviceCreateOptions extends Docker.CreateServiceOptions {
    TaskTemplate: taskTemplate;
    Name: string;
}

export class DockerService {
    name;
    image;
    options;
    service: Docker.Service | null = null;
    readyFunction;

    constructor(
        options: serviceCreateOptions,
        readyFunction?: (service: Docker.Service) => Promise<boolean>
    ) {
        this.name = options.Name;
        this.image = options.TaskTemplate.ContainerSpec.Image;
        this.options = options;
        this.readyFunction = readyFunction;
    }

    async start() {
        if (!(await imageExists(this.image))) {
            await pullImage(this.image);
        }

        try {
            const serviceResponse = await DOCKER_CONN.createService(
                this.options
            );
            if (serviceResponse.ID) {
                await this.getService();
            }
        } catch (err) {
            if (
                (
                    err as {
                        statusCode: number;
                    }
                ).statusCode === 409 &&
                this.name
            ) {
                await this.getService();
            } else {
                throw err;
            }
        }
    }

    async waitReady(timeout = 5000) {
        if (!this.service) await this.getService();
        if (this.service) {
            if (this.readyFunction) {
                return this.readyFunction(this.service);
            } else {
                return isServiceReady(this.service, timeout);
            }
        }
        throw new Error(
            `Service not found while trying to check ready: ${this.name}.`
        );
    }

    async remove() {
        if (!this.service) await this.getService();
        if (this.service) {
            const serviceInfo = await this.service.inspect();
            if (serviceInfo) {
                await this.service.remove();
                this.service = null;
                return;
            }
        }
        throw new Error(`No service found while removing: ${this.name}.`);
    }

    async waitRemoved(timeout = 5000) {
        if (this.service) {
            await tryUntil(async () => {
                const serviceInfo = await this.service!.inspect();
                return !serviceInfo;
            }, timeout);
        }
    }

    async scale(replicas: number) {
        if (!this.service) await this.getService();
        if (this.service) {
            await this.service.update({
                mode: {
                    replicated: {
                        replicas: replicas,
                    },
                },
            });
        }
        throw new Error(
            `No service found while scaling: ${this.options.Name}.`
        );
    }

    async getService() {
        if (this.options.Name) {
            const service = await getServiceByName(this.options.Name);

            if (service) {
                this.service = service;
                return this.service;
            }
        }
        throw new Error(
            `No service found while trying to get service: ${this.name}.`
        );
    }

    async getContainers() {
        if (!this.service) await this.getService();
        if (this.service) {
            const containers = await getServiceContainers(this.service);
            return containers;
        }
        throw new Error(
            `No service found while trying to get containers: ${this.options.Name}.`
        );
    }

    async getExecLoad(
        filterFn: (
            execInspect: Docker.ExecInspectInfo
        ) => boolean | Promise<boolean> = (execInspect) => execInspect.Running
    ) {
        if (!this.service) await this.getService();
        if (this.service) {
            const containers = await this.getContainers();
            return getExecLoad(containers, filterFn);
        }
        throw new Error(
            `No service found while trying to get exec load: ${this.options.Name}.`
        );
    }
}
