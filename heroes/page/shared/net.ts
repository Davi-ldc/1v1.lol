import type { Native } from '../../../src/page/native';
import { field, literal, runtime, slot, staticField, typeInfo } from '../symbols';

/**
 * The heroes' messages to every client, over the Seeker's own message (heroes/README.md, "Network messages"): the
 * ProjectileManager's PhotonView.RPC (slot 8110) "ProjectileEventRPC" to All, as TriggerProjectileEventRemotely
 * (f42915) sends it but without its live-projectile check, carrying one int under the projectile ID
 * `hero:<kind>:<sender's OwnerID>`, which no live projectile has. The hook on ProjectileEventRPC (slot 117807) takes
 * these IDs and lets every other one through.
 */
const PREFIX = 'hero:';
export type HeroMessage = 'lock' | 'charge' | 'flip' | 'stretch' | 'slap' | 'projectile' | 'projectilestop' | 'knock'
  | 'sword' | 'swordknock';
export type HeroNet = Awaited<ReturnType<typeof installHeroNet>>;

export async function installHeroNet(n: Native) {
  const event = n.call(slot.typeGetType, n.newString('JustPlay.Projectiles.HomingProjectileLockOnEvent, 1v1'), 1, 0);
  const object = n.call(slot.typeGetType, n.newString('System.Object, mscorlib'), 1, 0);
  const ownerId = (player: number) => n.call(slot.playerOwnerId, player, 0);
  /** The registered player with this OwnerID (PlayersManager._allPlayers is keyed by it), else 0. */
  function player(id: number) {
    const manager = n.resolvedClass(typeInfo.PlayersManager)
      ? n.u32(n.staticFields(typeInfo.PlayersManager), staticField.PlayersManager.Instance) : 0;
    const all = manager ? n.u32(manager, field.PlayersManager._allPlayers) : 0;
    return (all ? n.dictionary(all) : []).find(([key]) => key === id)?.[1] ?? 0;
  }
  const handlers = new Map<string, (sender: number, value: number) => void>();

  const install = await n.prepareHook(slot.projectileEventRpc, 4, original => (manager, id, data, method) => {
    const text = id ? n.textOrNull(id) : null;
    if (!text?.startsWith(PREFIX)) return original(manager, id, data, method);
    try {
      const [kind, sender] = text.slice(PREFIX.length).split(':');
      const hero = player(Number(sender));
      const value = n.i32(data, runtime.boxedValue + field.HomingProjectileLockOnEvent.TargetID);
      if (hero) handlers.get(kind!)?.(hero, value);
    } catch (error) { console.error('LOCAL_HERO_NET', String(error)); }
    return 0;
  }, 0);
  install();

  return {
    ownerId, player,
    on(kind: HeroMessage, handler: (sender: number, value: number) => void) { handlers.set(kind, handler); },
    /** Sends `value` as `sender`'s `kind`; the new managed objects are held until the RPC is sent. */
    send(kind: HeroMessage, sender: number, value: number) {
      const handles: number[] = [];
      const hold = (managed: number) => { handles.push(n.gcAlloc(managed)); return managed; };
      try {
        const data = hold(n.check(n.call(slot.createInstance, event, 0)));
        n.setI32(data, runtime.boxedValue + field.HomingProjectileLockOnEvent.TargetID, value);
        const id = hold(n.newString(`${PREFIX}${kind}:${ownerId(sender)}`));
        const parameters = hold(n.check(n.call(slot.arrayCreateInstance, object, 2, 0)));
        n.setU32(parameters, runtime.arrayData, id);
        n.setU32(parameters, runtime.arrayData + 4, data);
        const manager = n.check(n.u32(n.staticFields(typeInfo.ProjectileManager),
          staticField.ProjectileManager._instance));
        n.call(slot.photonViewRpc, n.check(n.call(slot.photonView, manager, 0)),
          hold(n.newString('ProjectileEventRPC')), literal.rpcAll, parameters, 0);
      } finally { handles.forEach(handle => n.gcFree(handle)); }
    },
  };
}
