import Docker from 'dockerode';
import { DOCKER_CONN } from './lib';

export default class DockerNetwork {
    network: Docker.Network | null = null;
    options: Docker.NetworkCreateOptions;

    constructor(options: Docker.NetworkCreateOptions) {
        this.options = options;
    }

    async create() {
        this.network = await DOCKER_CONN.createNetwork(this.options);
    }

    async connect(container: Docker.Container) {
        const network = await this.getNetwork();
        if (!network) throw new Error(`Could not connect to network, not found: ${this.options.Name}`);
        await network.connect({
            Container: container.id
        });
    }

    async getNetwork(): Promise<Docker.Network | null> {
        const [ networkInfo ] = await DOCKER_CONN.listNetworks({
            filters: {
                name: [this.options.Name]
            }
        });
        
        return networkInfo?.Id ? DOCKER_CONN.getNetwork(networkInfo.Id) : null;
    }

    async prune() {
        if (this.network) {
            const results = await DOCKER_CONN.pruneNetworks({
                filters: {
                    id: [this.network.id]
                }
            });
            if (results.NetworksDeleted.length === 0) {
                throw new Error(`Could not prune network: ${this.options.Name}`);
            }
        }
    }
}
