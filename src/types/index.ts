export interface ServerInfo {
  id: string;
  kind: 'local' | 'remote';
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'none';
  createdAt: string;
  hasSecret?: boolean;
}

export interface Metrics {
  cpuPercent: number;
  memTotal: number;
  memUsed: number;
  diskTotal: number;
  diskUsed: number;
  uptimeSeconds: number;
  loadAvg: string;
  cores: number;
  os: string;
  hostname: string;
  at: string;
}

export interface Pm2App {
  name: string;
  id: number;
  status: string;
  cpu: number;
  memory: number;
  restarts: number;
  uptimeMs: number;
  cwd: string;
  version: string;
  instances: number;
  execMode: string;
}

export interface Overview {
  metrics: Metrics;
  pm2: boolean;
  apps: Pm2App[];
}

export interface EnvVar {
  key: string;
  value: string;
}

export interface DeployRequest {
  name: string;
  repo: string;
  branch: string;
  port?: string;
  env: EnvVar[];
  startCmd: string;
}

export interface NginxFileInfo {
  name: string;
  enabled: boolean;
  domains: string;
}
