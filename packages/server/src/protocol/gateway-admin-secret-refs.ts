export interface GatewaySecretRefPayload {
  secretRef: string;
  providerId: string;
  label: string;
  backend: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface GatewayPutSecretRefPayload {
  apiVersion?: string;
  secretRef?: string;
  providerId: string;
  label?: string;
  secret: string;
  backend?: string;
}

export interface GatewayPutSecretRefResponsePayload {
  secretRef: GatewaySecretRefPayload;
  created: boolean;
}

export interface GatewayListSecretRefsPayload {
  apiVersion?: string;
  providerId?: string;
}

export interface GatewayListSecretRefsResponsePayload {
  secretRefs: GatewaySecretRefPayload[];
}

export interface GatewayDeleteSecretRefPayload {
  apiVersion?: string;
  secretRef: string;
}

export interface GatewayDeleteSecretRefResponsePayload {
  secretRef: string;
  deleted: boolean;
}
