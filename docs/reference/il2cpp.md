# IL2CPP

IL2CPP turned the game's C# into C++, and Emscripten compiled that into `WebGL.wasm` (SHA-256 `52b3dc8a…`). Names, types and fields live in `global-metadata.dat` (SHA-256 `7aa3236f…`, version 31).

## Conventions

These hold in every file under `docs/reference/`.

- `f44925` is a function index in `WebGL.wasm` and `slot 9029` an index in its function table. They are different numbers for the same method (see [From a method to its code](#from-a-method-to-its-code)).
- `+N` is an instance field offset and `static +N` an offset in the class's static-field block, both in bytes for wasm32. Instance offsets include the 8-byte object header, as the metadata reports them. A value type stored inline in another object or passed by pointer has no header, so subtract 8 there.
- Linear-memory addresses and WASM file offsets are hexadecimal, and file offsets are always labeled as such. Offsets into other files (the loader, the framework, `global-metadata.dat`) are decimal byte offsets.
- An asset is written `serialized:PathID`, for example `resources.assets:1709`. PathIDs are local to their serialized file inside `data.unity3d`.
- An async method is named by its state machine, for example `<Initialize>d__20::MoveNext`.
- Unmarked statements are confirmed in the files. "Inferred" names the link that was not verified, "unknown" stays unknown, and "observed" marks state read from the original client while it ran, without tracing the code that produced it.

## Metadata

`global-metadata.dat` opens with a 256-byte header: the magic `0xFAB11BAF`, the version 31 and 31 offset/size pairs. It describes 254 images (assemblies), 24,606 type definitions, 150,488 method definitions, 101,714 fields, 153,283 parameters and 24,927 string literals. A version 31 record takes 88 bytes per type, 36 per method (including `returnParameterToken`), 12 per field or parameter and 40 per image.

The top byte of a token names its table: `0x02` for types, `0x06` for methods, `0x04` for fields. The low bytes are the row id (RID) inside the image, counting from 1.

The metadata holds names, signatures, field offsets, the default values of constants and enum members, and attribute flags. It has no method bodies.

## Registrations

Two structures tie the metadata to the compiled code. Function f188461 (file offset `0x38bccde`, 67 bytes) stores their addresses at start-up.

`Il2CppMetadataRegistration` is at `0x727e94`:

| Field | Address | Entries |
|---|---|---:|
| `types` (`Il2CppType` pointers) | `0x1301f0` | 76,879 |
| `fieldOffsets` | `0xa89040` | 24,606 |
| `typeDefinitionsSizes` | `0xaa10c0` | 24,606 |
| generic classes | | 27,264 |
| generic instances | | 22,094 |
| generic method table | | 162,035 |
| method specs | `0x40ec60` | 199,578 |

`Il2CppCodeRegistration` is at `0x959888` and lists 254 code-gen modules (count at `0x9598c4`, array at `0xbbece0`). The `1v1.dll` module is at `0x830ea0`: 21,831 methods with `methodPointers` at `0xb61d70`, 1,924 adjustor thunks, 58 reverse P/Invoke wrappers, 152 RGCTX ranges and 1,344 RGCTX entries.

## From a method to its code

Four different numbers identify one method: the metadata token, the table slot, the function index and the file offset of the body. `BuildingManager.UpdateBuilding` (method index 875 in `1v1.dll`) shows the chain:

```text
token        0x0600036c          RID 0x36c = 876
pointer      methodPointers + 4 × (RID − 1) = 0xb62b1c
slot         u32 at 0xb62b1c = 9029
function     table element 9029 = f44925 (index includes the 615 imports)
body         file offset 0xf794de, 1,908 bytes
```

In `WebGL.wasm`, a method pointer is a table slot. 132,434 method definitions have a non-zero slot through their module. The other 18,054 have slot 0 on that path: generic definitions, abstract methods and methods reached only through shared generic code.

## Shared bodies

The compiler folds identical bodies, so one function often stands for many methods. `AddressablesHandler.set_DidInit` is f22612, a 9-byte body shared by 11 methods, and `get_DidDownloadRequiredData` is f13997, shared by 83 methods. A label on a `call` instruction lists every method that shares the target body, so it cannot say which one the caller meant.

Two things pin the name: a table slot that a method's pointer names, or the `MethodInfo` the caller passes. In generic code, one shared body serves every reference-type instantiation, and the caller selects the instantiation through a metadata cell. For example, the call site with cell `0xada7b8` resolves to method spec 192385, `Nullable<BuildingType>..ctor`, although the called function has unrelated aliases. The reference docs cite a folded body by the slot or cell that pins the method, and a shared generic body as `f<index>` next to the generic method it serves.

## Calling convention

Every managed method compiles to a WebAssembly function of this shape:

```text
instance method   (this, arg1, …, argN, MethodInfo*) -> result
static method     (arg1, …, argN, MethodInfo*) -> result
```

Non-generic callees ignore the trailing `MethodInfo*`, and callers often pass 0 for it. Shared generic code reads its type arguments from it.

References, integers, bools and enums are `i32`, `float` is `f32` and `double` is `f64`. Structs travel by pointer. A method that returns a struct takes a pointer to the result as its first parameter, before `this`. For example, `BuildingCalculation.GetGridAlignedPosition(Vector3)` (f44978) has the WASM signature `(i32 result, i32 this, i32 position, i32 MethodInfo) -> ()`. It reads `this` (parameter 1) at +24/+28 and stores the result at +0/+4/+8 of parameter 0.

## Direct calls and table calls

A method reaches another method in one of three ways:

| Form | In the code | Target |
|---|---|---|
| Direct call | `call f44925` | fixed at compile time |
| Indirect call | `call_indirect` on a slot loaded at run time | the slot read from memory |
| Invoke wrapper | `i32.const <slot>`, then `call env.invoke_*` | the slot, called from JavaScript in a try/catch |

Virtual and interface dispatch and delegates use indirect calls. Emscripten uses the invoke wrappers for calls inside exception-handling regions. In `BuildingManager.CheckInitiated` (f44932), file offsets `0xf7a4fa..0xf7a502` push slot 9024 (`InputManager.GetButtonDown`, f46968) and call import `env.invoke_iii`.

Every call that goes through the table follows whatever function the table holds at that slot. That covers vtables (their method pointers are slots), delegates and invoke wrappers. A direct `call` keeps its target, so a method that is only ever called directly cannot be redirected through the table.

## Metadata usage cells

Compiled code does not embed type or method pointers. It loads them from metadata usage cells, 4-byte words in linear memory that hold an encoded reference until first use. In the initial memory image:

```text
low bit = 1                      the cell is still encoded
usage   = word >>> 29            1 TypeInfo, 2 Il2CppType, 3 MethodDef, 4 FieldInfo, 5 StringLiteral, 6 MethodRef
index   = (word & 0x1fffffff) >>> 1
```

The code passes the cell's address to the IL2CPP initializer (f1964, table slot 1916), which resolves the reference and writes the pointer back into the cell. From then on the cell holds a real (even) pointer, so a cell whose word is odd has not been initialized yet. A method's code usually starts with `i32.const <cell>` followed by that call. For example, cell `0xad194c` holds `MethodRef[184976]`, `Dictionary<string, PartyPlayer>::Clear`.

A field reference (usage 4) is relative to its owner. f1644 (file offsets `0x1c18ce..0x1c18e0`) resolves the type, loads its fields pointer at `klass+64` and adds `fieldIndex × 20` (the size of `FieldInfo`).

## Memory layout

### Objects and classes

Every object starts with an 8-byte header: its class pointer at +0 and a monitor at +4.

| Il2CppClass field | Offset | Evidence |
|---|---:|---|
| `name` (C string) | +8 | |
| `fields` | +64 | f1644 |
| `static_fields` | +92 | |
| vtable | +192 | f98131, f97484 |

Each vtable slot is a `VirtualInvokeData {methodPtr, method}` of 8 bytes. A virtual call reads the object's class, takes entry `192 + 8 × slot`, and calls `methodPtr` (a table slot) with the entry's `method` as the trailing `MethodInfo*`. `FirebaseConfigHandler.ActivateRemoteConfig` (f98131, file offset `0x205717b`) loads slot 4 at +224/+228, and `IsItemMaxLevel` (f97484, file offset `0x2013096`) loads slot 6 at +240/+244.

### Static fields

Static fields live in a separate block that `klass+92` points to, allocated when the class is initialized. Static field offsets count from the start of that block. Each generic instantiation has its own block. For example, the statics of `AFirebaseSettingsHandler<T>` keep `Data` at +8 and `IsDataAvailable` at +12 for every `T` (`GameManager.SetGameStartTime`, f45926; `FlyingCheatDetector.GetMaxFlyingTime`, f51356).

Constants (`const` fields) and enum members have no storage. Their value is a metadata default, for example `BuildingManager.AMMO_PER_BUILD = 10` (field 1146).

### Built-in types

| Type | Layout |
|---|---|
| `System.String` | length (i32) at +8, UTF-16 characters from +12 |
| Arrays | length at +12, elements from +16 (4 bytes each for references) |
| `List<T>` | `_items` (array) at +8, `_size` at +12, `_version` at +16 |
| `Dictionary<K, V>` | `_buckets` at +8, `_entries` at +12, `_count` at +16, `_comparer` at +32 (`FindEntry`, f155823) |
| `Queue<T>` | `_array`, `_head`, `_tail`, `_size` after the header (inferred) |
| Boxed value type | the value's fields start at +8 |
| `Nullable<float>` | `hasValue` at +0, value at +4 (`get_Value`, f157418) |
| ObscuredInt | 16 bytes inline: key +0, hidden value +4, fake value +8, fake-active +12, inited +13 |

A `Dictionary` entry is `{hashCode, next, key, value}`, 16 bytes when key and value take 4 bytes each (`TryGetValue`, f155836). ObscuredInt comes from CodeStage AntiCheat, and its value is `key XOR hidden` once `inited` is set.

## Unknowns

- The method bodies are real compiled code, decoded instruction by instruction. They have not been decompiled back to C#, and many branches of the decoded bodies have not been interpreted.
- A short or empty body is the real body (for example, `BuildingCalculation.CalculatePosition` shares the stub f4077), but on its own it says nothing about behavior.
- Some nested type names collide, so identify a type or method by image plus token or index, never by name alone.
