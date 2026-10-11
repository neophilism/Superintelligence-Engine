export class EngineClient {
  constructor({baseUrl,fetchImpl=fetch}={}) { const url=new URL(baseUrl); if(!['https:','http:'].includes(url.protocol)) throw new TypeError('Unsupported URL'); this.baseUrl=url.toString(); this.fetchImpl=fetchImpl; }
  async health() { const response=await this.fetchImpl(new URL('/health',this.baseUrl)); if(!response.ok) throw new Error('Engine API returned '+response.status); return response.json(); }
  async capabilities() { const response=await this.fetchImpl(new URL('/v1/capabilities',this.baseUrl)); if(!response.ok) throw new Error('Engine API returned '+response.status); return response.json(); }
}
