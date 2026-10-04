# Movement

How the player's character moves in build 4.713: input to the motor, jumps, falls, knockback, how remote players move, and the cheat detectors that watch movement. Notation follows the [conventions](il2cpp.md#conventions).

## Input

Movement reads Rewired axes 14 and 15, Horizontal and Vertical (see [controls.md](controls.md#rewired-actions)). `vThirdPersonInput.MoveCharacter` (f118146) passes each to `InputManager.GetAxisRaw` (f46977) and stores the results in the motor's `input`, a Vector2 at +536, so the axes land at +536 and +540.

## Jump

`vThirdPersonInput.JumpInput` (f118149) reads `GetButtonDown` for Jump (0), and its `JumpConditions` require the ground. `vThirdPersonMotor.ControlJumpBehaviour` (f118170) runs from `UpdateMotor` every physics step, grounded or not. While `isJumping` is set, it holds the Rigidbody's vertical velocity at `jumpHeight` and counts `jumpCounter` down from `jumpTimer`.

## Fall damage

`PlayerController.HandleFalling` (f48576) keeps the takeoff height in `_lastGroundedYPosition`. On landing it calls `PlayerHealth.HandleFallDamage(lastYPos, newYPos)` (f48665, slot 107417), which deals damage only when `lastYPos − newYPos − _fallDamageDistance ≥ 0`. `_fallDamageCurve` gives the amount. Going by its name, `_fallDeathDistance` is the height that kills (inferred). [combat.md](combat.md#health-and-armor) lists the fields.

## Knockback

Knockback has no RPC; the victim's own client applies it. `PlayerController.ApplyKnockback(force)` (f48591, slot
10225) calls `vThirdPersonMotor.ApplyKnockback` (f118179).

On the ground the motor keeps the impulse for only `|F| · 0.0005` s, and `vThirdPersonAnimator.OnAnimatorMove` (f118086), which runs only while grounded, brakes it. A purely horizontal push therefore barely moves a grounded player. In the air the player keeps the speed until landing, and the motor's `extraGravity` (+328) shortens that time.

The player's Rigidbody weighs 40 kg. The Sentinel's shockwave pushes with forward · 400 + up · 150 (`BarrierShockwave.KnockbackForce`, `KnockbackUpForce`).

## Remote players

On other clients a player moves by its transform alone: `PlayerController.UpdateRemoteTransform` (f48572) calls `Transform.set_position`. Its hit colliders sit on a dynamic, interpolated Rigidbody.

In combat, `Physics.autoSyncTransforms` is off. `PlayerController.ChangeState` (f48568) turns it on only for the Building state, or when the remote setting `FpsSettings.ForceActivateAutoSyncColliders` (+8) asks for it. A remote player's colliders can therefore stay where its body last rested while the transform moves on.

## Cheat detection

`PlayerController.CheatsMonitor._cheatDetectors` holds detectors such as `FlyingCheatDetector`. Their limits come from remote configuration (`CheaterSettings`, see [boot.md](boot.md#remote-config)), and with the default (0) every jump counts as flying. After a detection the game disables that detector with `Behaviour.set_enabled(false)`, and its `OnDisable` unsubscribes it.

## Unknowns

- How `_fallDamageCurve` maps height to damage.
