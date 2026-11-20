"""Fit the supplied six-part Quaternius rig to the city's pedestrian budget."""
from pathlib import Path

import math
import bmesh
import bpy
from mathutils import Vector

from sys import path
path.insert(0, str(Path(__file__).resolve().parent))
from crowd_lod import add_crowd_indices
from convert_mixamo import ROOT, make_active, reduce_mesh, tris

SOURCE = ROOT.parent / 'characters/quaternius-casual-female.glb'
OUTPUT = ROOT / 'game/assets/glb/female.glb'
BUDGET = {'Skin': 925, 'Shirt': 350, 'Pants': 174, 'Belt': 38, 'Face': 195, 'Hair': 435}


def head_weight(obj, vertex):
    head = obj.vertex_groups['Head'].index
    return sum(g.weight for g in vertex.groups if g.group == head)


def accent(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    return material


def dress_details(rig, skin, face):
    # This casual source ends at the ankles. Fit low-top canvas shoes to
    # its two animated feet and keep the existing armature's foot weights.
    parts = []
    canvas = accent('Canvas', (.065,.095,.10))
    rubber = accent('Rubber', (.68,.65,.55))
    iris = accent('Iris', (.021,.012,.008))
    lips = accent('Lips', (.26,.062,.052))

    def piece(name, verts, faces, materials, slots, bone):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = rig
        obj.matrix_world.identity()
        for mat in materials:
            mesh.materials.append(mat)
        for poly, slot in zip(mesh.polygons, slots):
            poly.material_index = slot
            poly.use_smooth = True
        group = obj.vertex_groups.new(name=bone)
        group.add(list(range(len(verts))), 1, 'REPLACE')
        arm = obj.modifiers.new('Skin', 'ARMATURE')
        arm.object = rig
        parts.append(obj)

    for side in ('L','R'):
        bone = 'Foot'+side
        index = skin.vertex_groups[bone].index
        foot = [skin.matrix_world@v.co for v in skin.data.vertices
               if any(g.group==index and g.weight>.38 for g in v.groups)]
        x = sum(p.x for p in foot)/len(foot)
        y = sum(p.y for p in foot)/len(foot)
        z = min(p.z for p in foot)-.009
        outline = [(-.40,-.31),(.40,-.31),(.50,-.13),(.50,.38),(.41,.62),
                   (.21,.73),(-.21,.73),(-.41,.64),(-.5,.41),(-.5,-.15)]
        verts, faces, slots = [], [], []
        for layer, (width,length) in enumerate(((.97,.98),(1,1),(.94,.96),(.66,.78))):
            for dx,forward in outline:
                height = (0,.021,.026,.076-.042*max(0,forward))[layer]
                verts.append((x+dx*.134*width, y-forward*.22*length, z+height))
        count = len(outline)
        for layer in range(3):
            for i in range(count):
                j = (i+1)%count
                faces.append((layer*count+i,(layer+1)*count+i,(layer+1)*count+j,layer*count+j))
                slots.append(1 if layer<2 else 0)
        faces.extend([tuple(range(count)),tuple(reversed(range(3*count,4*count)))])
        slots.extend([1,0])
        for i in range(3):
            top=z+.073-i*.005
            forward=.019+i*.016
            k=len(verts)
            verts.extend([(x-.034,y-forward,top),(x+.031,y-forward-.005,top),
                          (x+.031,y-forward-.012,top),(x-.034,y-forward-.007,top)])
            faces.append((k+3,k+2,k+1,k)); slots.append(1)
        piece('Sneaker'+side, verts, faces, [canvas,rubber], slots, bone)

    # The imported Face material covers both eyebrows and the pale eye
    # shapes. Split the disconnected islands by height using the existing
    # geometry, then put an iris on the front of each eye.
    world = face.matrix_world
    coords = [world@v.co for v in face.data.vertices]
    z0,z1 = min(p.z for p in coords),max(p.z for p in coords)
    split = z0 + (z1-z0)*.66
    face.data.materials.append(bpy.data.materials['Hair'])
    for poly in face.data.polygons:
        if min(coords[i].z for i in poly.vertices)>split:
            poly.material_index = 1
    mid = (min(p.x for p in coords)+max(p.x for p in coords))/2
    for side in (-1,1):
        eye=[p for p in coords if (p.x-mid)*side>0 and p.z<split]
        x=(min(p.x for p in eye)+max(p.x for p in eye))*.5
        z=(min(p.z for p in eye)+max(p.z for p in eye))*.5
        y=min(p.y for p in eye)-.0007
        verts=[(x,y-.001,z)]+[(x+.0056*math.cos(i*math.tau/10),y,z+.008*math.sin(i*math.tau/10)) for i in range(10)]
        piece('Iris'+str(side),verts,[(0,1+i,1+(i+1)%10) for i in range(10)],[iris],[0]*10,'Head')
    # Follow the facial surface with a narrow curved lip line.
    inverse = skin.matrix_world.inverted()
    mouth_z=z0-(z1-z0)*.43
    verts=[]
    for i in range(9):
        t=(i-4)/4
        x=mid+.020*t
        z=mouth_z+.003*t*t
        hit,point,_,_=skin.ray_cast(inverse@Vector((x,-2,z)),
            inverse.to_3x3()@Vector((0,1,0)))
        if not hit:
            raise ValueError('Cannot locate the facial surface')
        y=(skin.matrix_world@point).y-.0009
        thick=.0005+.002*(1-t*t)
        verts.extend(((x,y,z+thick),(x,y,z-thick)))
    piece('Mouth',verts,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(8)],[lips],[0]*8,'Head')
    return parts


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE), merge_vertices=True)
    rig, = [obj for obj in bpy.data.objects if obj.type == 'ARMATURE']
    meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH' and obj.find_armature() == rig]
    rig.animation_data.action = None
    for b in rig.pose.bones:
        b.matrix_basis.identity()
    skin, = [obj for obj in meshes if obj.data.materials[0].name == 'Skin']
    pts = [skin.matrix_world @ v.co for v in skin.data.vertices if head_weight(skin, v) > .5]
    chin = min(v.z for v in pts)
    points = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    crown, floor = max(v.z for v in points), min(v.z for v in points)
    scale = (chin-floor) / ((crown-chin) * 6.5)
    # Preserve the neck seam and the head pivot. Long hair below the jaw is
    # part of the hairstyle and follows the same transform as the face.
    pivot = skin.matrix_world @ Vector((0, 0, 0))
    pivot.z = chin
    for obj in meshes:
        region = obj.data.materials[0].name
        inv = obj.matrix_world.inverted()
        for v in obj.data.vertices:
            weight = head_weight(obj, v)
            if region == 'Skin':
                for side in ('L','R'):
                    fist = 'Fist'+side
                    fi = obj.vertex_groups[fist].index
                    influence = sum(g.weight for g in v.groups if g.group==fi)
                    if influence:
                        wrist = rig.matrix_world @ rig.data.bones[fist].head_local
                        p = obj.matrix_world @ v.co
                        v.co = inv @ p.lerp(wrist+(p-wrist)*.60, influence)
            if weight:
                p = obj.matrix_world @ v.co
                v.co = inv @ p.lerp(pivot+(p-pivot)*scale, weight)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
        bm.to_mesh(obj.data)
        bm.free()
        reduce_mesh(obj, BUDGET[region]/tris(obj))
        obj.name = region
    bpy.context.view_layer.update()
    face = next(obj for obj in meshes if obj.name=='Face')
    meshes.extend(dress_details(rig,skin,face))
    print('Character regions', [(obj.name, tris(obj)) for obj in meshes])
    make_active(rig)
    parent = rig.parent
    while parent:
        parent.select_set(True)
        parent = parent.parent
    for obj in meshes:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_animation_mode='NLA_TRACKS',
        export_frame_step=1, export_anim_slide_to_zero=True, export_cameras=False,
        export_lights=False, export_extras=False)
    add_crowd_indices(OUTPUT)

if __name__ == '__main__':
    main()
