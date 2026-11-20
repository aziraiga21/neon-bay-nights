"""Blender 4.2: blender -b --factory-startup --python-exit-code 1 -P tools/blender/convert_mixamo.py."""
import argparse
import json
from pathlib import Path
import random
import struct
import sys

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from crowd_lod import add_crowd_indices
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
CLIPS = {
    'idle': 'Idle', 'walk': 'Walk', 'run': 'Run', 'jump': 'Jump',
    'punch': 'Punch', 'pistol-idle': 'PistolIdle', 'pistol-aim': 'PistolAim',
    'pistol-shoot': 'PistolShoot', 'sitting': 'Sitting',
}


def import_rig(path, animation):
    objects = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), use_anim=animation, use_image_search=False)
    created = sorted(set(bpy.data.objects) - objects, key=lambda o: o.name)
    rigs = [obj for obj in created if obj.type == 'ARMATURE']
    if len(rigs) != 1:
        raise ValueError(f'{path.name}: expected one armature, got {len(rigs)}')
    return rigs[0], created


def make_active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def tris(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def reduce_mesh(obj, ratio):
    make_active(obj)
    mod = obj.modifiers.new('Silhouette budget', 'DECIMATE')
    mod.ratio = min(1, ratio)
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # Keep the FBX weights interpolated by the collapse modifier. glTF uses
    # the strongest four influences, normalised; never rigid-bind a loose point.
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bones = set(obj.find_armature().data.bones.keys())
    groups = {g.index for g in obj.vertex_groups if g.name in bones}
    for v in obj.data.vertices:
        if sum(g.weight for g in v.groups if g.group in groups) < .999:
            raise ValueError(f'{obj.name}: missing bone weights on vertex {v.index}')


def simplify_materials(meshes):
    # Pack the original face, clothing and footwear UV islands into two
    # adjacent tiles. Every animated person now uses one draw per pass.
    materials = {slot.material for o in meshes for slot in o.material_slots if slot.material}
    tiles = {}
    pixels = np.empty((512, 1024, 4), dtype=np.float32)
    for mat in sorted(materials, key=lambda m: m.name):
        shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        image = shader.inputs['Base Color'].links[0].from_node.image
        if image.name not in tiles:
            i = len(tiles)
            if i > 1:
                raise ValueError('Unexpected diffuse atlas layout')
            tiles[image.name] = i
            image.scale(512, 512)
            texels = np.empty(512*512*4, dtype=np.float32)
            image.pixels.foreach_get(texels)
            pixels[:, i*512:(i+1)*512] = texels.reshape((512,512,4))
        mat['tile'] = tiles[image.name]
    atlas = bpy.data.images.new('Jax_Diffuse', width=1024, height=512, alpha=False)
    atlas.pixels.foreach_set(pixels.ravel())
    atlas.file_format = 'JPEG'
    atlas.pack()
    clothing = bpy.data.materials.new('Jax clothing and skin')
    clothing.use_nodes = True
    nt = clothing.node_tree
    shader = nt.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .84
    texture = nt.nodes.new('ShaderNodeTexImage')
    texture.image = atlas
    nt.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    for obj in meshes:
        uv = obj.data.uv_layers.active.data
        for polygon in obj.data.polygons:
            tile = obj.material_slots[polygon.material_index].material['tile']
            for index in polygon.loop_indices:
                # Ch06 has a second UDIM tile. Normalise that tile before packing.
                u = uv[index].uv.x
                uv[index].uv.x = (tile + (u - 1 if tile and u >= 1 else u)) * .5
        obj.data.materials.clear()
        obj.data.materials.append(clothing)


def transfer(main, folder):
    # FBX animation-only files reconstruct a slightly different rest stance
    # from the skinned FBX. Transport each sampled world rotation through both
    # bind bases, then express it in the target bone's parent space.
    ordered = sorted(main.pose.bones, key=lambda b: len(b.parent_recursive))
    for file, name in CLIPS.items():
        source, created = import_rig(folder / (file + '.fbx'), True)
        original = source.animation_data and source.animation_data.action
        if not original:
            raise ValueError(f'{file}: armature has no action')
        by_name = {b.name.rsplit(':', 1)[-1]: b for b in source.pose.bones}
        pairs = []
        for bone in ordered:
            src = by_name.get(bone.name.rsplit(':', 1)[-1])
            if not src or (src.parent and src.parent.name.rsplit(':', 1)[-1] != bone.parent.name.rsplit(':', 1)[-1]):
                raise ValueError(f'{file}: incompatible hierarchy at {bone.name}')
            target_rest = bone.bone.matrix_local.to_quaternion()
            parent_rest = bone.parent.bone.matrix_local.to_quaternion() if bone.parent else None
            local_rest = parent_rest.inverted() @ target_rest if parent_rest else target_rest
            pairs.append((bone, src, src.bone.matrix_local.to_quaternion().inverted() @ target_rest, local_rest.inverted()))
        action = bpy.data.actions.new(name)
        channels = {b.name: [action.fcurves.new(b.path_from_id('rotation_quaternion'), index=i) for i in range(4)] for b in ordered}
        hip = ordered[0]
        location = [action.fcurves.new(hip.path_from_id('location'), index=i) for i in range(3)]
        previous = {}
        first, last = map(round, original.frame_range)
        for frame in range(first, last+1):
            bpy.context.scene.frame_set(frame)
            world = {}
            for bone, src, correction, inverse in pairs:
                q = src.matrix.to_quaternion() @ correction
                world[bone.name] = q
                rotation = inverse @ (world[bone.parent.name].inverted() @ q if bone.parent else q)
                if bone.name in previous:
                    rotation.make_compatible(previous[bone.name])
                previous[bone.name] = rotation
                for curve, v in zip(channels[bone.name], rotation):
                    curve.keyframe_points.insert(frame-first, v, options={'FAST'})
            src = pairs[0][1]
            offset = src.matrix.translation - src.bone.matrix_local.translation
            # Armature Y is vertical in the Mixamo FBX. The simulation owns
            # horizontal displacement. Keep the authored rise and crouch.
            vertical = hip.bone.matrix_local.to_quaternion().inverted() @ Vector((0, offset.y, 0))
            for curve, v in zip(location, vertical):
                curve.keyframe_points.insert(frame-first, v, options={'FAST'})
        for curve in action.fcurves:
            curve.update()
        action.use_fake_user = True
        main.animation_data_create()
        track = main.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, action)
        track.mute = True
        print(name, len(pairs), 'animated bones, frames', tuple(action.frame_range))
        for obj in created:
            bpy.data.objects.remove(obj, do_unlink=True)


def export(out, selected, draco=False):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in selected:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format='GLB', use_selection=True, export_apply=True,
        export_yup=True, export_animation_mode='NLA_TRACKS', export_frame_step=2,
        export_anim_slide_to_zero=True, export_optimize_animation_size=True,
        export_image_format='JPEG', export_jpeg_quality=85, export_extras=False,
        export_draco_mesh_compression_enable=draco, export_draco_mesh_compression_level=7)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT.parent / 'characters/mixamo')
    parser.add_argument('--out', type=Path, default=ROOT / 'game/assets/glb/jax.glb')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    random.seed(1706)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig, objects = import_rig(args.source / 'jax-character.fbx', False)
    print('Main armature', rig.name, len(rig.data.bones), list(rig.data.bones.keys()), flush=True)
    meshes = [o for o in objects if o.type == 'MESH' and o.find_armature() == rig]
    if not meshes:
        raise ValueError('No mesh bound to the hero armature')
    total = sum(tris(o) for o in meshes)
    print('Input geometry', [(o.name, tris(o)) for o in meshes])
    for obj in meshes:
        reduce_mesh(obj, 2480 / total)
    simplify_materials(meshes)
    transfer(rig, args.source)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    export(args.out, [rig, *meshes])
    if args.out.stat().st_size > 2_000_000:
        export(args.out, [rig, *meshes], draco=True)
    add_crowd_indices(args.out)
    raw = args.out.read_bytes()
    doc = json.loads(raw[20:20+struct.unpack_from('<I', raw, 12)[0]])
    names = [a['name'] for a in doc['animations']]
    count = sum(doc['accessors'][p['indices']]['count']//3 for m in doc['meshes'] for p in m['primitives'])
    print('GLB', len(raw), 'bytes;', count, 'triangles;', len(doc['nodes']), 'nodes;', names)
    assert len(raw) <= 2_000_000 and 1000 <= count <= 2500 and sorted(names) == sorted(CLIPS.values())


if __name__ == '__main__':
    main()
