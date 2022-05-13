# node-docker-classes
Opinionated wrapper classes for the Docker API using dockerode.  

# Basic Examples

See test for more examples.
## DockerContainer

```javascript
const uuid = randomUUID();
const container = new DockerContainer({
    Image: "alpine:latest",
    name: uuid,
    Cmd: [
        "sh",
        "-c",
        'while sleep 3600; do :; done'
    ]
});
await container.start();
await container.waitReady();
const [stdout, stderr] = await runExec(container, ["echo", "Hello, world!"]);
await container.remove();
await container.waitRemoved();
```

## DockerService

```javascript
const uuid = randomUUID();
const dockerService = new DockerService({
    Name: uuid,
    TaskTemplate: {
        ContainerSpec: {
            Image: "alpine:latest",
            Command: ["sh", "-c", 'while sleep 3600; do :; done']
        },
    },
    Mode: {
        Replicated: {
            Replicas: 4
        },
    },
});
await dockerService.start();
await dockerService.waitReady();
const containers = await dockerService.getContainers();
const randomContainer = containers[Math.floor(Math.random() * containers.length)];
const [stdout, stderr] = await runExec(randomContainer, ["echo", "Hello, world!"]);
await dockerService.remove();
await dockerService.waitRemoved();
```
