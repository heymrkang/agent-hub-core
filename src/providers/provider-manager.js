import { CodexAdapter } from './codex/codex-adapter.js';
import { AntigravityAdapter } from './antigravity/antigravity-adapter.js';

class ProviderManager {
  constructor() { this.adapters = new Map(); this.initDefaultAdapters(); }
  initDefaultAdapters() { this.registerAdapter(new CodexAdapter()); this.registerAdapter(new AntigravityAdapter()); }
  registerAdapter(adapter) { this.adapters.set(adapter.name.toLowerCase(), adapter); console.log(`[ProviderManager] Provider 등록 완료: ${adapter.name}`); }
  getAdapter(name='codex') { const adapter=this.adapters.get(name.toLowerCase()); if(!adapter) throw new Error(`지원하지 않는 Provider입니다: ${name}`); return adapter; }
  listProviderNames() { return Array.from(this.adapters.keys()); }
  async getProvidersStatus() {
    const results=[];
    for(const [name,adapter] of this.adapters.entries()){
      try{const health=await adapter.checkHealth();const auth=await adapter.checkAuth();results.push({name,healthy:health.healthy,version:health.version||'알 수 없음',authenticated:auth.authenticated,authDetails:auth.details,capabilities:adapter.getCapabilities()});}
      catch(error){results.push({name,healthy:false,error:error.message});}
    }
    return results;
  }
}
export const providerManager = new ProviderManager();
