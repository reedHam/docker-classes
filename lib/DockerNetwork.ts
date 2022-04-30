import Docker from 'dockerode';
import { DOCKER_CONN } from './utils';
import { waitUntil } from './utils';

export class DockerNetwork {
    name: string;
    network: Docker.Network | null = null;
    options: Docker.NetworkCreateOptions;

    constructor(options: Docker.NetworkCreateOptions) {
        this.name = options.Name;
        this.options = options;
    }

    async create() {
        try {
            this.network = await DOCKER_CONN.createNetwork({
                ...this.options,
                Labels: {
                    ...this.options.Labels,
                    'com.docker.network.name': 'default'    
                }
            });
        } catch (err) {
            if ((err as {   
                statusCode: number;
            }).statusCode === 409) {
                this.network = DOCKER_CONN.getNetwork(this.name);
            } else {
                throw err;
            }
        }
    }

    async connect(container: Docker.Container) {
        const network = await this.getNetwork();
        if (!network) throw new Error(`Could not connect to network, not found: ${this.options.Name}`);
        await network.connect({
            Container: container.id
        });
    }

    async getNetwork(): Promise<Docker.Network> {
        if (this.network) {
            return this.network;
        } else {
            const network = await DockerNetwork.getNetwork(this.options.Name);
            if (network) {
                this.network = network;
                return network;
            }
        }
        throw new Error(`Could not get network: ${this.options.Name}`);
    }
    
    static async getNetwork(name: string): Promise<Docker.Network | null> {
        const [ networkInfo ] = await DOCKER_CONN.listNetworks({
            filters: {
                name: [name]
            }
        });
        console.log(networkInfo);
        return networkInfo?.Id ? DOCKER_CONN.getNetwork(networkInfo.Id) : null;
    }

    async prune() {
        if (this.network) {
            await waitUntil(async () => {
                const results = await DOCKER_CONN.pruneNetworks({
                    filters: {
                        label: [`com.docker.network.name=${this.name}`]
                    }
                });
                return !results?.NetworksDeleted?.length;
            });
        }
    }
}
