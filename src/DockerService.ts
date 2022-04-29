import Docker from 'dockerode';
import { DOCKER_CONN, isServiceReady, waitUntil, getServiceContainers, getServiceByName } from './lib';


export class DockerService {
    name;
    options;
    service: Docker.Service | null = null;
    readyFunction;

    constructor(options: Docker.CreateServiceOptions, readyFunction?: (...args: any[]) => Promise<any>) {
        this.name = options.Name;
        this.options = options;
        this.readyFunction = readyFunction;
    }

    async start() {
        const serviceResponse = await DOCKER_CONN.createService(this.options);
        if (serviceResponse.ID) {
            const service = DOCKER_CONN.getService(serviceResponse.ID);
            this.service = service;
        } 
        throw new Error(`Service could not be created: ${this.options.Name}.`);
    }

    async waitReady(timeout = 5000) {
        if (this.service) {
            if (this.readyFunction) {
                return this.readyFunction(this.service);
            } else {
                return isServiceReady(this.service, timeout);
            }
        }
        throw new Error(`Service not found while trying to check ready: ${this.options.Name}.`);
    }

    async remove() {
        if (this.service) {
            const serviceInfo = await this.service.inspect();
            if (serviceInfo) {
                await this.service.remove();
            }
        }
        throw new Error(`No service found while removing: ${this.options.Name}.`);
    }

    async waitRemoved(timeout = 5000) {
        if (this.service) {
            await waitUntil(async () => {
                const serviceInfo = await this.service?.inspect();
                return !serviceInfo;
            }, timeout);
        }
        throw new Error(`No service found while waiting to remove: ${this.options.Name}.`);
    }

    async scale(replicas: number) {
        if (this.service) {
            await this.service.update({
                mode: {
                    replicated: {
                        replicas: replicas
                    }
                }
            });
        }
        throw new Error(`No service found while scaling: ${this.options.Name}.`);
    }

    async getService() {
        if (this.options.Name) {
            const service = await getServiceByName(this.options.Name);
            if (service) {
                this.service = service;
                return this.service;
            }
        }
        throw new Error(`No service found while trying to get service: ${this.options.Name}.`);
    }

    async getContainers() {
        if (this.service) {
            const containers = await getServiceContainers(this.service);
            return containers;
        }
        throw new Error(`No service found while trying to get containers: ${this.options.Name}.`);
    }
}

