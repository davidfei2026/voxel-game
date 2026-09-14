// ==========================================
// 1. ENGINE INITIALIZATION & SYSTEM MATRICES
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x84b0ff);
scene.fog = new THREE.FogExp2(0x84b0ff, 0.012);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// Environment Lighting Structures
const ambient = new THREE.AmbientLight(0xffffff, 0.75);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 0.45);
sun.position.set(50, 120, 40);
scene.add(sun);

const controls = new THREE.PointerLockControls(camera, document.body);
document.body.addEventListener('click', () => { if(!controls.isLocked) controls.lock(); });

// ==========================================
// 2. TEXTURE PIPELINE GENERATION
// ==========================================
function buildProceduralTexture(hexColor, noiseFactor) {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const r = (hexColor >> 16) & 255, g = (hexColor >> 8) & 255, b = hexColor & 255;
    for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
            let offset = (Math.random() - 0.5) * noiseFactor;
            ctx.fillStyle = `rgb(${Math.floor(Math.min(255,Math.max(0,r+offset)))},${Math.floor(Math.min(255,Math.max(0,g+offset)))},${Math.floor(Math.min(255,Math.max(0,b+offset)))})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    return tex;
}

const materials = {
    grass: new THREE.MeshLambertMaterial({ map: buildProceduralTexture(0x557a2b, 15) }),
    dirt: new THREE.MeshLambertMaterial({ map: buildProceduralTexture(0x866043, 20) }),
    stone: new THREE.MeshLambertMaterial({ map: buildProceduralTexture(0x737373, 30) }),
    wood: new THREE.MeshLambertMaterial({ map: buildProceduralTexture(0xa07040, 15) }),
    leaves: new THREE.MeshLambertMaterial({ map: buildProceduralTexture(0x3a5f25, 35), transparent: true, opacity: 0.95 })
};

// ==========================================
// 3. SEED-BASED PROCEDURAL TERRAIN NOISE
// ==========================================
// Pseudo-random noise fallback mapping 2D vectors smoothly onto coordinate scalar outputs
function getNoise2D(x, z) {
    let nx = Math.sin(x * 0.11) * Math.cos(z * 0.09) * 4;
    let nz = Math.cos(x * 0.03 + z * 0.05) * Math.sin(z * 0.04) * 8;
    return Math.floor(nx + nz);
}

// ==========================================
// 4. VOXEL DICTIONARY & INSTANCED RENDERING ARCHITECTURE
// ==========================================
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const worldMap = {}; 
const renderGroups = {}; 
const renderDistanceChunks = 24;

function blockKey(x, y, z) { return `${x},${y},${z}`; }

function registerBlock(x, y, z, type, rebuild = false) {
    const key = blockKey(x, y, z);
    if(worldMap[key]) return;
    worldMap[key] = type;
    if(rebuild) updateInstancedRenderGroup();
}

function unregisterBlock(x, y, z) {
    const key = blockKey(x, y, z);
    if(worldMap[key]) {
        delete worldMap[key];
        updateInstancedRenderGroup();
    }
}

// Highly Optimized Batching Loop utilizing THREE.InstancedMesh
function updateInstancedRenderGroup() {
    // Clear old active scenes elements geometry paths
    Object.keys(renderGroups).forEach(k => scene.remove(renderGroups[k]));
    
    const countByType = {};
    Object.keys(worldMap).forEach(key => {
        let type = worldMap[key];
        countByType[type] = (countByType[type] || 0) + 1;
    });

    Object.keys(countByType).forEach(type => {
        const total = countByType[type];
        const instMesh = new THREE.InstancedMesh(cubeGeometry, materials[type], total);
        let currentIdx = 0;
        const dummy = new THREE.Object3D();

        Object.keys(worldMap).forEach(key => {
            if(worldMap[key] !== type) return;
            const [x, y, z] = key.split(',').map(Number);
            dummy.position.set(x, y, z);
            dummy.updateMatrix();
            instMesh.setMatrixAt(currentIdx++, dummy.matrix);
        });

        instMesh.instanceMatrix.needsUpdate = true;
        scene.add(instMesh);
        renderGroups[type] = instMesh; // Save track pointers references
    });
}

// Procedural Environment Instantiation Pipeline
function spawnTreeStructure(tx, startY, tz) {
    let h = 4 + Math.floor(Math.random() * 2);
    for(let i=0; i<h; i++) worldMap[blockKey(tx, startY+i, tz)] = 'wood';
    let topY = startY + h;
    for(let lx=-2; lx<=2; lx++){
        for(let lz=-2; lz<=2; lz++){
            for(let ly=-2; ly<=1; ly++){
                if(Math.abs(lx) + Math.abs(ly) + Math.abs(lz) <= 3.5){
                    let k = blockKey(tx+lx, topY+ly, tz+lz);
                    if(!worldMap[k]) worldMap[k] = 'leaves';
                }
            }
        }
    }
}

function generateChunkWorld() {
    for (let x = -renderDistanceChunks; x <= renderDistanceChunks; x++) {
        for (let z = -renderDistanceChunks; z <= renderDistanceChunks; z++) {
            let groundHeight = getNoise2D(x, z);
            
            worldMap[blockKey(x, groundHeight, z)] = 'grass';
            worldMap[blockKey(x, groundHeight - 1, z)] = 'dirt';
            for(let d = groundHeight - 2; d >= groundHeight - 5; d--) {
                worldMap[blockKey(x, d, z)] = 'stone';
            }

            // Scatter Vegetation
            if (x % 9 === 0 && z % 9 === 0 && Math.random() < 0.4) {
                spawnTreeStructure(x, groundHeight + 1, z);
            }
        }
    }
    updateInstancedRenderGroup();
}
generateChunkWorld();

// ==========================================
// 5. PLAYER PHYSICS & COLLISION SOLVER
// ==========================================
const player = {
    velocity: new THREE.Vector3(),
    radius: 0.3, height: 1.75, onGround: false
};
camera.position.set(0, 15, 0);

function evaluateEnvironmentCollisions(targetPos) {
    const bMinX = Math.floor(targetPos.x - player.radius), bMaxX = Math.floor(targetPos.x + player.radius);
    const bMinZ = Math.floor(targetPos.z - player.radius), bMaxZ = Math.floor(targetPos.z + player.radius);
    const bMinY = Math.floor(targetPos.y - player.height), bMaxY = Math.floor(targetPos.y);

    for (let x = bMinX; x <= bMaxX; x++) {
        for (let y = bMinY; y <= bMaxY; y++) {
            for (let z = bMinZ; z <= bMaxZ; z++) {
                if (worldMap[blockKey(x, y, z)]) return true;
            }
        }
    }
    return false;
}

// ==========================================
// 6. UI INTERACTION & HOTBAR SWAPPING
// ==========================================
let inventoryIndex = 'grass';
const slots = document.querySelectorAll('.slot');
slots.forEach(slot => {
    slot.addEventListener('click', (e) => {
        slots.forEach(s => s.classList.remove('active'));
        slot.classList.add('active');
        inventoryIndex = slot.getAttribute('data-block');
        e.stopPropagation();
    });
});

const activeKeys = { w:0, a:0, s:0, d:0 };
window.addEventListener('keydown', e => {
    if(e.code === 'KeyW') activeKeys.w = 1; if(e.code === 'KeyA') activeKeys.a = 1;
    if(e.code === 'KeyS') activeKeys.s = 1; if(e.code === 'KeyD') activeKeys.d = 1;
    if(e.code === 'Space' && player.onGround) { player.velocity.y = 0.20; player.onGround = false; }
    if(e.key >= '1' && e.key <= '5') {
        slots.forEach(s => s.classList.remove('active'));
        let targetSlot = document.querySelector(`.slot[data-slot="${e.key - 1}"]`);
        targetSlot.classList.add('active');
        inventoryIndex = targetSlot.getAttribute('data-block');
    }
});
window.addEventListener('keyup', e => {
    if(e.code === 'KeyW') activeKeys.w = 0; if(e.code === 'KeyA') activeKeys.a = 0;
    if(e.code === 'KeyS') activeKeys.s = 0; if(e.code === 'KeyD') activeKeys.d = 0;
});

// ==========================================
// 7. RAYCAST VOXEL DIGGING / BUILDING PIPELINE
// ==========================================
window.addEventListener('mousedown', e => {
    if(!controls.isLocked) return;
    
    // Construct picking calculations relative to direct crosshair space vectors
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
    raycaster.far = 6.5;

    // Collect discrete virtual meshes bounding boxes intersections
    const lookupList = Object.keys(worldMap).map(k => {
        const [x,y,z] = k.split(',').map(Number);
        const box = new THREE.Box3(new THREE.Vector3(x-0.5, y-0.5, z-0.5), new THREE.Vector3(x+0.5, y+0.5, z+0.5));
        return { key: k, box: box, dist: box.distanceToPoint(camera.position) };
    }).filter(b => raycaster.ray.intersectsBox(b.box)).sort((a,b) => a.dist - b.dist);

    if(lookupList.length > 0) {
        const targetBlock = lookupList[0];
        const [tx, ty, tz] = targetBlock.key.split(',').map(Number);

        if(e.button === 0) { // Left-Click: Mine block
            unregisterBlock(tx, ty, tz);
        } else if(e.button === 2) { // Right-Click: Build block
            // Determine intersection face normalization offsets directions vector
            const ray = raycaster.ray;
            let intersectionPoint = new THREE.Vector3();
            ray.intersectBox(targetBlock.box, intersectionPoint);
            
            let nx = 0, ny = 0, nz = 0;
            const diffX = intersectionPoint.x - tx, diffY = intersectionPoint.y - ty, diffZ = intersectionPoint.z - tz;
