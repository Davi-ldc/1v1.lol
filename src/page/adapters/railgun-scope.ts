import { factory } from '../game';
import type { Native } from '../native';
import { field, methodInfo, slot } from '../symbols';

const RAILGUN = 'lol.1v1.weapons.railgun', SNIPER = 'lol.1v1.weapons.military_sniper';

/**
 * Adaptation: a railgun scope. The original railgun aims without a scope: its
 * WeaponBaseData.Stats.ZoomSettings has HasScope false and FieldOfView 45 (the default aim is 50.5). It gets the
 * military sniper's zoom settings (HasScope, ScopeType Sniper, FieldOfView 15; the auto sniper's are the same). A
 * WeaponModel copies Stats when it is created (WeaponModel.Stats), and WeaponsController.UpdateScopeState (f106756)
 * shows the scope from that copy, so every railgun created afterwards aims with it.
 */
export async function installRailgunScope(n: Native) {
  const catalogue = n.list(n.call(slot.factoryAllProducts, factory(n, methodInfo.productFactoryInstance), 0), 4096);
  const zoom = (id: string) => {
    const product = catalogue.find(item => n.text(n.u32(item, field.ProductData.Id)) === id);
    if (!product) throw new Error(`${id} is not in the catalogue.`);
    const base = n.check(n.u32(product, field.EquipmentProductData.BaseData));
    return base + field.WeaponBaseData.Stats + field.WeaponStats.ZoomSettings;
  };
  const railgun = zoom(RAILGUN), sniper = zoom(SNIPER), Z = field.CameraZoomSettings;
  if (!n.bool(sniper, Z.HasScope)) throw new Error('The military sniper has no scope.');
  for (const offset of [Z.HasScope, Z.ScopeType, Z.FieldOfView]) n.setU32(railgun, offset, n.u32(sniper, offset));
  return { scope: n.i32(railgun, Z.ScopeType), fieldOfView: n.f32(railgun, Z.FieldOfView) };
}
