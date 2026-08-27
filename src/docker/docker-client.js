import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SOCKET_PATH = process.env.DOCKER_HOST?.replace(/^unix:\/\//, '') || '/var/run/docker.sock';

export class DockerClient {
  static async getSummary() {
    const socketPresent = fs.existsSync(SOCKET_PATH);
    try {
      const { stdout: versionOut } = await execFileAsync('docker', ['version', '--format', '{{json .}}'], { timeout: 10000 });
      let version = null;
      try { version = JSON.parse(versionOut.trim()); } catch {}
      const { stdout: infoOut } = await execFileAsync('docker', ['info', '--format', '{{json .}}'], { timeout: 10000 });
      let info = null;
      try { info = JSON.parse(infoOut.trim()); } catch {}
      return {
        available: true,
        socketPresent,
        clientVersion: version?.Client?.Version || null,
        serverVersion: version?.Server?.Version || null,
        containers: info?.Containers ?? null,
        running: info?.ContainersRunning ?? null,
        images: info?.Images ?? null
      };
    } catch (error) {
      return {
        available: false,
        socketPresent,
        error: String(error.stderr || error.message || '').trim().slice(0, 700)
      };
    }
  }

  static async ps(limit = 20) {
    const { stdout } = await execFileAsync('docker', ['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'], { timeout: 10000 });
    return stdout.trim().split('\n').filter(Boolean).slice(0, limit).map((line) => {
      const [id, name, image, status] = line.split('\t');
      return { id, name, image, status };
    });
  }
}
