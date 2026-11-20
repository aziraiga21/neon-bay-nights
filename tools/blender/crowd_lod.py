"""Bake an alternate index buffer for small on-screen figures, sharing the original skin and atlas."""
import base64
import gzip
import json
import struct

import bmesh
import bpy
from mathutils.kdtree import KDTree


def add_crowd_indices(path):
    raw = path.read_bytes()
    n = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20+n])
    binary = raw[28+n:]

    def values(index):
        a = doc['accessors'][index]
        view = doc['bufferViews'][a['bufferView']]
        width = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[a['type']]
        record = struct.Struct('<'+str(width)+{5126: 'f', 5123: 'H', 5125: 'I'}[a['componentType']])
        off = view.get('byteOffset', 0)+a.get('byteOffset', 0)
        return [record.unpack_from(binary, off+i*view.get('byteStride', record.size)) for i in range(a['count'])]

    total = 0
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            a = prim['attributes']
            pos = values(a['POSITION'])
            uv = values(a['TEXCOORD_0']) if 'TEXCOORD_0' in a else None
            ind = [v[0] for v in values(prim['indices'])]
            geometry = bpy.data.meshes.new('Crowd silhouette')
            geometry.from_pydata(pos, [], list(zip(ind[::3], ind[1::3], ind[2::3])))
            if uv:
                layer = geometry.uv_layers.new()
                for loop in geometry.loops:
                    layer.data[loop.index].uv = uv[loop.vertex_index]
            bm = bmesh.new()
            bm.from_mesh(geometry)
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
            bm.to_mesh(geometry)
            bm.free()
            obj = bpy.data.objects.new('Crowd silhouette', geometry)
            bpy.context.collection.objects.link(obj)
            bpy.context.view_layer.objects.active = obj
            mod = obj.modifiers.new('Subpixel folds', 'DECIMATE')
            mod.ratio = .20
            mod.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=mod.name)
            geo = obj.data
            geo.calc_loop_triangles()
            tree = KDTree(len(pos))
            for i, p in enumerate(pos):
                tree.insert(p, i)
            tree.balance()
            nearest = [tree.find_n(v.co, min(16, len(pos))) for v in geo.vertices]
            corners = []
            for loop in geo.loops:
                candidates = nearest[loop.vertex_index]
                if uv:
                    u, v = geo.uv_layers.active.data[loop.index].uv
                    # Keep the original side of UV seams on the simplified surface.
                    key = lambda c: c[2]**2 + .2*((u-uv[c[1]][0])**2+(v-uv[c[1]][1])**2)
                    corners.append(min(candidates, key=key)[1])
                else:
                    corners.append(candidates[0][1])
            indices = []
            for tri in geo.loop_triangles:
                face = [corners[i] for i in tri.loops]
                if len(set(face)) == 3:
                    indices.extend(face)
            prim.setdefault('extras', {})['crowdIndices'] = indices
            total += len(indices)//3
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(geometry)
    payload = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode()
    payload += b' ' * (-len(payload)%4)
    rest = raw[20+n:]
    path.write_bytes(struct.pack('<4sIII4s', b'glTF', 2, 20+len(payload)+len(rest), len(payload), b'JSON') + payload + rest)
    # A sandboxed iframe or a browser with storage disabled can still import
    # a static ES module. Supply a compressed copy only for that cold path.
    packed = gzip.compress(path.read_bytes(), compresslevel=9, mtime=0)
    module = path.with_suffix('.bytes.js')
    module.write_text('// Generated offline GLB bytes for storage-restricted browsers.\nexport default "' +
                      base64.b64encode(packed).decode('ascii') + '";\n')
    print('Distant character triangles', total)
