// =====================================================================
//  A grid of cubes with random colors and random heights, in WebGL
// =====================================================================
//
// THE BIG PICTURE
// ---------------
// WebGL can only draw points, lines and triangles. To draw a cube we
// describe it as 12 triangles (2 per face × 6 faces), hand those
// triangles to the GPU, and then ask the GPU to draw that cube once for
// every cube in our list, each time with a different position, height
// and color.
//
// Every frame of WebGL drawing follows the same basic steps:
//
//   1. SHADERS  - small programs that run on the GPU. The *vertex shader*
//                 decides where each corner (vertex) of a triangle lands
//                 on the screen. The *fragment shader* decides the color
//                 of each pixel inside the triangle.
//   2. BUFFERS  - we copy our vertex data (the corners of the cube) into
//                 GPU memory once, at startup.
//   3. UNIFORMS - values that stay the same for a whole draw call, like
//                 "this cube is red" or "this cube is 3 units tall".
//                 We change them before drawing each cube.
//   4. DRAW     - we tell the GPU "draw 36 vertices as triangles".
//
// The sections below follow that same order.


// ---------------------------------------------------------------------
// 0. Get a WebGL "context" from the <canvas> element in index.html.
//    The context (gl) is the object we use to issue every WebGL command.
// ---------------------------------------------------------------------
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl');


// ---------------------------------------------------------------------
// 1. SHADERS
//    Shaders are written in GLSL, a C-like language. We store the source
//    code in JavaScript strings, then compile them for the GPU.
//
//    Three kinds of shader variables:
//      attribute - a different value for every vertex (e.g. its position)
//      uniform   - one value shared by every vertex in a draw call
//      varying   - passed from the vertex shader to the fragment shader
// ---------------------------------------------------------------------

const vertexShaderSource = `
  attribute vec3 aPosition;   // corner position of the cube (model space)
  attribute vec3 aNormal;     // direction the face is pointing

  uniform mat4 uModel;        // moves/scales THIS cube into the world
  uniform mat4 uView;         // where the camera is and where it looks
  uniform mat4 uProjection;   // perspective: far things look smaller

  varying vec3 vNormal;       // handed to the fragment shader

  void main() {
    // Turn the normal the same way the cube is turned. Our cubes are only
    // stretched and moved, never rotated, so this changes nothing here.
    // It would matter if you added rotation.
    vNormal = normalize(mat3(uModel) * aNormal);

    // model -> world -> camera -> screen.
    // Read right to left: first place the cube in the world (uModel),
    // then view it from the camera (uView), then apply perspective (uProjection).
    gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;    // how accurate decimal numbers are (medium is plenty)

  uniform vec3 uColor;        // this cube's color (red, green, blue: 0..1)
  varying vec3 vNormal;       // received from the vertex shader

  void main() {
    // This runs once for EVERY PIXEL inside each triangle. The GPU blends
    // vNormal between the triangle's three corners, so each pixel gets
    // its own value. On a flat cube face all corners share the same
    // normal, so every pixel on that face gets the same one.

    // Simple lighting so we can tell the faces of a cube apart.
    // The light shines from above and slightly to the side.
    vec3 lightDirection = normalize(vec3(0.5, 1.0, 0.3));

    // dot() measures how closely two directions line up:
    //   1 = the face points straight at the light (brightest)
    //   0 = the face is sideways to the light
    //   negative = the face points away, so max() clamps it to 0 (dark)
    float brightness = max(dot(vNormal, lightDirection), 0.0);

    // Keep 30% "ambient" light so faces in shadow aren't pure black.
    float light = 0.3 + 0.7 * brightness;

    // gl_FragColor is the built-in output: the final color of this pixel.
    // Multiplying the cube's color by light darkens it on dim faces.
    gl_FragColor = vec4(uColor * light, 1.0);   // 1.0 = fully opaque
  }
`;

// Compile one shader and report any GLSL errors.
function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

// A "program" for the GPU
// is a vertex shader + a fragment shader linked together.
const program = gl.createProgram();
gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexShaderSource));
gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource));
gl.linkProgram(program);
gl.useProgram(program);


// ---------------------------------------------------------------------
// 2. CUBE GEOMETRY → BUFFER
//
//    WHAT IS A BUFFER?
//    The GPU has its own memory, separate from the memory JavaScript
//    uses. The GPU can't reach into our JavaScript arrays while it
//    draws, so we copy the data over ahead of time. A BUFFER is a block
//    of GPU memory that holds that copy.
//
//    WHAT DOES IT HOLD?
//    Just a long list of numbers. A buffer has no idea what the numbers
//    mean. Here they are the corners (vertices) of a cube: each vertex's
//    position and its normal, packed one vertex after another.
//
//    DETAILS
//    We copy the cube into the buffer ONCE, at startup. After
//    that, every draw call reads straight from GPU memory, so drawing
//    100 cubes (or 100 cubes every frame) never re-sends the triangles.
//
//    Using a buffer takes three steps, all in the code below:
//      1. Put the numbers in a JavaScript array   (cubeVertices)
//      2. Copy that array into a GPU buffer       (createBuffer, bufferData)
//      3. Tell the GPU how to read the numbers    (vertexAttribPointer):
//         "the first 3 numbers of each vertex go to aPosition,
//          the next 3 go to aNormal"
//
//    CUBE details
//    One cube, 1 unit wide, with its bottom at y = 0 (so it sits on the
//    ground). Every cube in the scene reuses this same data;
//    uModel is what makes each one different- it is a 4×4 matrix
//    that takes the one shared cube and places it in the world.
//
//    Each face = 2 triangles = 6 vertices. Each vertex has 6 numbers:
//         x,    y,    z,      nx, ny, nz   (position, then normal)
// ---------------------------------------------------------------------
const cubeVertices = new Float32Array([
  // Front face (normal points toward +z)
  -0.5, 0, 0.5,   0, 0, 1,
   0.5, 0, 0.5,   0, 0, 1,
   0.5, 1, 0.5,   0, 0, 1,
  -0.5, 0, 0.5,   0, 0, 1,
   0.5, 1, 0.5,   0, 0, 1,
  -0.5, 1, 0.5,   0, 0, 1,

  // Back face (-z)
  -0.5, 0, -0.5,  0, 0, -1,
   0.5, 1, -0.5,  0, 0, -1,
   0.5, 0, -0.5,  0, 0, -1,
  -0.5, 0, -0.5,  0, 0, -1,
  -0.5, 1, -0.5,  0, 0, -1,
   0.5, 1, -0.5,  0, 0, -1,

  // Top face (+y)
  -0.5, 1, -0.5,  0, 1, 0,
  -0.5, 1,  0.5,  0, 1, 0,
   0.5, 1,  0.5,  0, 1, 0,
  -0.5, 1, -0.5,  0, 1, 0,
   0.5, 1,  0.5,  0, 1, 0,
   0.5, 1, -0.5,  0, 1, 0,

  // Bottom face (-y)
  -0.5, 0, -0.5,  0, -1, 0,
   0.5, 0,  0.5,  0, -1, 0,
  -0.5, 0,  0.5,  0, -1, 0,
  -0.5, 0, -0.5,  0, -1, 0,
   0.5, 0, -0.5,  0, -1, 0,
   0.5, 0,  0.5,  0, -1, 0,

  // Right face (+x)
   0.5, 0, -0.5,  1, 0, 0,
   0.5, 1, -0.5,  1, 0, 0,
   0.5, 1,  0.5,  1, 0, 0,
   0.5, 0, -0.5,  1, 0, 0,
   0.5, 1,  0.5,  1, 0, 0,
   0.5, 0,  0.5,  1, 0, 0,

  // Left face (-x)
  -0.5, 0, -0.5, -1, 0, 0,
  -0.5, 1,  0.5, -1, 0, 0,
  -0.5, 1, -0.5, -1, 0, 0,
  -0.5, 0, -0.5, -1, 0, 0,
  -0.5, 0,  0.5, -1, 0, 0,
  -0.5, 1,  0.5, -1, 0, 0,
]);
const VERTEX_COUNT = 36;

//Creating a canvas for the image
const sampleCanvas = document.createElement('canvas');
const sampleCtx = sampleCanvas.getContext('2d');

const image = new Image();

let imageWidth  = 568;
let imageHeight = 568;

let cubes = [];

//For level 3
let clouds = [];

//Imports the image and calls functions required to render
image.onload = function () {

  sampleCanvas.width = imageWidth;
  sampleCanvas.height = imageHeight;

  sampleCtx.drawImage(image, 0, 0);

  create_cubes();
  requestAnimationFrame(render);
};

image.src = 'https://raw.githubusercontent.com/hamil2ag/Computer-Graphics-I/refs/heads/main/Project2/image.png';

//Takes the data from the image in a way that can be used by create_cubes()
//rgb corresponds to the color data, and alpha corresponds to height
function image_loader(x, y) {

  const px = Math.floor(Math.max(0, Math.min(imageWidth - 1, x)));
  const py = Math.floor(Math.max(0, Math.min(imageHeight - 1, y)));

  const data = sampleCtx.getImageData(px, py, 1, 1).data;
  return [data[0], data[1], data[2], data[3]];
}



// Copy the vertex data into GPU memory.
//   createBuffer - reserve a new, empty buffer on the GPU
//   bindBuffer   - make it the "current" buffer; the next buffer
//                  commands act on whichever buffer is bound
//                  (ARRAY_BUFFER means "this holds vertex data")
//   bufferData   - copy our numbers into it. STATIC_DRAW is a hint
//                  that we'll fill it once and draw from it many times.
const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, cubeVertices, gl.STATIC_DRAW);

// Tell the GPU how to read the buffer: which numbers are the position
// and which are the normal.
//   stride = bytes from one vertex to the next = 6 floats × 4 bytes = 24
//   offset = where in each vertex this attribute starts
const BYTES_PER_FLOAT = 4;
const stride = 6 * BYTES_PER_FLOAT;

// Each attribute is hooked up in three steps:
//   getAttribLocation       - ask the linked program for the attribute's
//                             slot number (the JS variable holds that
//                             number, not the data itself)
//   enableVertexAttribArray - say "fill this attribute from a buffer"
//   vertexAttribPointer     - say HOW: read from the currently bound
//                             buffer, 3 numbers per vertex, as floats,
//                             not normalized, stepping `stride` bytes
//                             per vertex, starting at this offset

// aPosition: the first 3 numbers of each vertex (x, y, z), offset 0.
const aPosition = gl.getAttribLocation(program, 'aPosition');
gl.enableVertexAttribArray(aPosition);
gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, stride, 0);

// aNormal: the next 3 numbers (nx, ny, nz), so skip past the 3 position
// floats = 12 bytes into each vertex.
const aNormal = gl.getAttribLocation(program, 'aNormal');
gl.enableVertexAttribArray(aNormal);
gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, stride, 3 * BYTES_PER_FLOAT);

// Look up where each uniform lives so we can set it later.
// Unlike attributes, uniforms don't come from the buffer: we send their
// values directly from JavaScript (gl.uniformMatrix4fv, gl.uniform3fv)
// in draw(). As with attributes, these variables hold a LOCATION
// (an address in the program), not the value itself.
//   uModel      - per cube: moves and stretches the cube into place
//   uView       - per frame: the camera's position and direction
//   uProjection - per frame: perspective (far things look smaller)
//   uColor      - per cube: the cube's RGB color
const uModel = gl.getUniformLocation(program, 'uModel');
const uView = gl.getUniformLocation(program, 'uView');
const uProjection = gl.getUniformLocation(program, 'uProjection');
const uColor = gl.getUniformLocation(program, 'uColor');


// ---------------------------------------------------------------------
// 3. THE SCENE: a plain JavaScript list of cubes
//    This part has nothing to do with WebGL - it's just data.
//    The cubes are laid out in a GRID_SIZE × GRID_SIZE grid on the
//    ground plane (y = 0), centered on the origin.
// ---------------------------------------------------------------------
let GRID_SIZE = 150;
let height_coefficient = 0.1;
function create_cubes() {
  // const GRID_SIZE = 1000;   //bigger
  //const GRID_SIZE = 150;    // 10 × 10 = 100 cubes
  const SPACING = 1;    // distance between cube ce// nters

  //Reset the array every time the function is called
  //This is useful for resampling
  cubes.length = 0;

  //Creates the cubes for the campus
  if (level == 2 || level == 3 || level == 4){
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {

        const rgba = image_loader(col*imageWidth/GRID_SIZE, row*imageHeight/GRID_SIZE);

        cubes.push({
          x: (col - (GRID_SIZE - 1) / 2) * SPACING,
          z: (row - (GRID_SIZE - 1) / 2) * SPACING,
          height: rgba[3]*height_coefficient,
          color: [rgba[0]/255, rgba[1]/255, rgba[2]/255],
        });
      }
    }
  }
  //Creates the cubes for level 1
  else if (level == 1){
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {

        const rgba = image_loader(col*imageWidth/GRID_SIZE, row*imageHeight/GRID_SIZE);

        cubes.push({
          x: (col - (GRID_SIZE - 1) / 2) * SPACING,
          z: (row - (GRID_SIZE - 1) / 2) * SPACING,
          height: col/10+row/10,
          color: [Math.min(1,col/100), Math.min(1,col/400+row/400), Math.min(1,row/100)],
        });
      }
    }
  }
}

//Level 3 and Level 4
//Creates the cubes for the clouds
function create_clouds() {
  clouds.length = 0;
  if (level == 3 || level == 4){
    const SPACING = 0.5;
    for (let row = 0; row < GRID_SIZE / SPACING; row++) {
      for (let col = 0; col < GRID_SIZE / SPACING; col++) {

        const rgba = image_loader(col*imageWidth/GRID_SIZE, row*imageHeight/GRID_SIZE);
        cloud_colorer = Math.random()/50;
        
        //This conditional not only cuts up the clouds into chunks, it also determines their initial position based on time
        if ((row + seconds*1000) % 64 > 32 && (col + seconds*1000) % 72 > 32){
          clouds.push({
            x: ((col * SPACING) - (GRID_SIZE - 1) / 2),
            z: ((row * SPACING) - (GRID_SIZE - 1) / 2),
            height: 1,
            color: [0.8 + cloud_colorer, 0.8 + cloud_colorer, 0.8 + cloud_colorer],
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------
// 4. MATRIX HELPERS
//    A 4×4 matrix can move, scale, or rotate points. WebGL stores
//    matrices as 16 numbers in "column-major" order: the first 4 numbers
//    are the first COLUMN, not the first row. That's why the translation
//    (x, y, z) appears in the last 4 numbers below.
//
//    (Real projects usually use a library such as glMatrix for this.)
// ---------------------------------------------------------------------

// Move a point by (x, y, z).
function translation(x, y, z) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

// Stretch a point by (sx, sy, sz).
function scaling(sx, sy, sz) {
  return [
    sx, 0,  0,  0,
    0,  sy, 0,  0,
    0,  0,  sz, 0,
    0,  0,  0,  1,
  ];
}

// Multiply two matrices: the result does b first, then a.
function multiply(a, b) {
  const result = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) {
        result[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
      }
    }
  }
  return result;
}

// Perspective projection: makes far-away objects look smaller.
//   fieldOfView - how wide the camera sees, in radians
//   aspect      - canvas width / height, so things aren't stretched
//   near, far   - nothing closer than near or farther than far is drawn
function perspective(fieldOfView, aspect, near, far) {
  const f = 1 / Math.tan(fieldOfView / 2);
  return [
    f / aspect, 0, 0,                               0,
    0,          f, 0,                               0,
    0,          0, (far + near) / (near - far),    -1,
    0,          0, (2 * far * near) / (near - far), 0,
  ];
}

// Camera matrix: place a camera at `eye`, looking at `target`.
// `up` says which way is "up" for the camera (normally +y).
function lookAt(eye, target, up) {
  const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const normalize = (a) => {
    const length = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / length, a[1] / length, a[2] / length];
  };

  // Build the camera's own three axes:
  const zAxis = normalize(subtract(eye, target)); // points backward, away from what we look at
  const xAxis = normalize(cross(up, zAxis));      // points to the camera's right
  const yAxis = cross(zAxis, xAxis);              // points to the camera's up

  return [
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -dot(xAxis, eye), -dot(yAxis, eye), -dot(zAxis, eye), 1,
  ];
}

let ORBIT_RADIUS = 80.0;
let ORBIT_HEIGHT = 50.0;
let ORBIT_SPEED  = 0.1;

let LOOK_AT = [0.0, -30.0, 0.0];

const UP = [0, 1, 0];

//Moved out of render() for levels 3 and 4
let seconds = 0;

//Bezier curve logic for level 3
//Built off of example from https://lumitree.art/blog/bezier-curves, with an extra dimension added for 3D
var P0 = { x: -20, y: 0, z: 0};
var P1 = { x: 0, y: 5, z: 0};
var P2 = { x: 20, y: 0, z: 0};
let t = 0;
function lerp(a, b, t) { return a + (b - a) * t; }
function quadBezier(p0, p1, p2, t) {
  var x01 = lerp(p0.x, p1.x, t), y01 = lerp(p0.y, p1.y, t), z01 = lerp(p0.z, p1.z, t);
  var x12 = lerp(p1.x, p2.x, t), y12 = lerp(p1.y, p2.y, t), z12 = lerp(p1.z, p2.z, t);
  return { x: lerp(x01, x12, t), y: lerp(y01, y12, t), z: lerp(z01, z12, t) };
}

function render(timeInMilliseconds) {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.enable(gl.DEPTH_TEST);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  //resizeCanvas() code from camera-move example
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);


  //Largely render() code from camera-move example
  seconds = timeInMilliseconds / 1000;
  const angle = seconds * ORBIT_SPEED;
  const eye = [
    ORBIT_RADIUS * Math.cos(angle),
    ORBIT_HEIGHT,
    ORBIT_RADIUS * Math.sin(angle),
  ];

  const viewMatrix = lookAt(eye, LOOK_AT, UP);
  const aspect = canvas.width / canvas.height;
  const projectionMatrix = perspective(90 * Math.PI / 180, aspect, 0.1, 1000.0);

  gl.uniformMatrix4fv(uView, false, viewMatrix);
  gl.uniformMatrix4fv(uProjection, false, projectionMatrix);

  for (const cube of cubes) {
    const model = multiply(
      translation(cube.x, 0, cube.z),
      scaling(1, cube.height, 1)
    );
    gl.uniformMatrix4fv(uModel, false, model);
    gl.uniform3fv(uColor, cube.color);
    gl.drawArrays(gl.TRIANGLES, 0, VERTEX_COUNT);
  }

  if (level == 3 || level == 4){

    //The clouds move along two bezier curves to make a loop
    if (((Math.floor(seconds*10) % 200)/100) < 1){
      P0 = { x: -10, y: 0, z: -10};
      P1 = { x: 20, y: 5, z: -20};
      P2 = { x: 10, y: 0, z: 10};
      t = (Math.floor(seconds*10) % 100)/100;
    }
    else if (((Math.floor(seconds*10) % 200)/100) >= 1){
      P0 = { x: 10, y: 0, z: 10};
      P1 = { x: -20, y: 5, z: 20};
      P2 = { x: -10, y: 0, z: -10};
      //t = 1 - (Math.floor(seconds*10) % 100)/100;
      t = (Math.floor(seconds*10) % 100)/100;
    }
    var cur = quadBezier(P0, P1, P2, t);

    for (const cloud of clouds) {
      //Level 4: Interesting atmospheric cloud effects (looks simple, but took some time to think through)
      //Basically each cube in the cloud will scale and translate a random amount.
      //So they don't warp so much that they lose their shape, they go back and forth based on time
      if (seconds % 4 > 2 && level == 4){
        cloud.height = cloud.height + Math.random()/38;
        cloud.x = cloud.x + Math.random()/10;
        cloud.z = cloud.z + Math.random()/20;
      }
      else if (seconds % 4 <= 2 && level == 4){
        cloud.height = cloud.height - Math.random()/40;
        cloud.x = cloud.x - Math.random()/10;
        cloud.z = cloud.z - Math.random()/20;

      }
      //Necessary for level 3 - translation and scaling of clouds
      const model = multiply(
        translation(cloud.x + cur.x, 40 + cur.y, cloud.z + cur.z),
        scaling(1, cloud.height, 1)
      );
      gl.uniformMatrix4fv(uModel, false, model);
      gl.uniform3fv(uColor, cloud.color);
      gl.drawArrays(gl.TRIANGLES, 0, VERTEX_COUNT);
    }
  }
  requestAnimationFrame(render);
}

//Defaults level to 2
let level = 2;

document.addEventListener("keydown", (event) => {
  event.preventDefault();
  //Push camera into the scene
  switch (event.key) {
    case ("ArrowDown"):
      ORBIT_RADIUS -= 1;
      ORBIT_HEIGHT -= 2;
      LOOK_AT[1] += 1;
  }
  //Pull camera out of the scene
  switch (event.key) {
    case ("ArrowUp"):
      ORBIT_RADIUS += 1;
      ORBIT_HEIGHT += 2;
      LOOK_AT[1] -= 1;
  }
  //Lower resolution scene
  switch (event.key) {
    case ("ArrowLeft"):
      if  (GRID_SIZE > 25){
        GRID_SIZE -= 25;
        create_cubes();
        create_clouds();
        ORBIT_RADIUS -= 12.5;
        ORBIT_HEIGHT -= 6.25;
        LOOK_AT[1] += 6.25;
      }
  }
  //Higher resolution scene
  switch (event.key) {
    case ("ArrowRight"):
      if  (GRID_SIZE < imageWidth && GRID_SIZE < imageHeight){
        GRID_SIZE += 25;
        create_cubes();
        create_clouds();
        ORBIT_RADIUS += 12.5;
        ORBIT_HEIGHT += 6.25;
        LOOK_AT[1] -= 6.25;
      }
  }
  //Depth of scene increases
  switch (event.key) {
    case ("="): //(+ key)
        height_coefficient = height_coefficient * (3/2);
        create_cubes();
        create_clouds();
  }
  //Depth of scene decreases
  switch (event.key) {
    case ("-"):
        height_coefficient = height_coefficient / (3/2);
        create_cubes();
        create_clouds();
  }
  //Level 1
  switch (event.key) {
    case ("1"):
        level = 1;
        create_cubes();
        create_clouds();
  }
  //Level 2 (default)
  switch (event.key) {
    case ("2"):
        level = 2;
        create_cubes();
        create_clouds();
  }
  //Level 3
  switch (event.key) {
    case ("3"):
        level = 3;
        create_cubes();
        create_clouds();
  }
  //Level 4
  switch (event.key) {
    case ("4"):
        level = 4;
        create_cubes();
        create_clouds();
  }
});

// Redraw if the browser window changes size: the canvas has a new
// shape, so the viewport and aspect ratio must be updated.
// (To animate, you would instead call draw() every frame with
// requestAnimationFrame and change something - like the camera -
// a little each time.)
window.addEventListener('resize', draw);
