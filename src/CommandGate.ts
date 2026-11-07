interface Call { at: number; device: string; command: string }
interface Budget { calls: Call[]; cooldown: number }
// Process-local rolling quota budget. Other clients can also consume Google's
// project budget, so a real 429 triggers a project-wide cooldown as well.
export class CommandGate {
    private now: () => number;
    private projects: Map<string, Budget>;
    constructor(now = Date.now) { this.now = now; this.projects = new Map(); }
    state(device: string) {
        const key = device.split('/devices/')[0];
        if (!this.projects.has(key)) this.projects.set(key, { calls: [], cooldown: 0 });
        return this.projects.get(key)!;
    }
    admit(device: string, command: string, background = false) {
        const now = this.now(), state = this.state(device);
        state.calls = state.calls.filter(c => now - c.at < 3600000);
        const minute = state.calls.filter(c => now - c.at < 60000);
        const ownMinute = minute.filter(c => c.device === device);
        const ownHour = state.calls.filter(c => c.device === device);
        if (now < state.cooldown || minute.length >= (background ? 6 : 10) ||
            ownMinute.length >= 30 || ownHour.length >= 100 ||
            ownMinute.filter(c => c.command === command).length >= 5) {
            const error = Object.assign(new Error('Local camera command budget exhausted; cached frame retained'), { code: 429, localQuota: true });
            throw error;
        }
        state.calls.push({ at: now, device, command });
    }
    rateLimited(device: string) { this.state(device).cooldown = this.now() + 60000; }
}
export const commandGate = new CommandGate();
