# Studio: World Effects

This project demonstrates how to create interactive world effects in **8th Wall Studio**, including **tap-to-place**, **gesture controls**, and **absolute scale AR**.  
Users can tap to place 3D content in the real world, manipulate it with gestures, and view it at real-world scale.

---

# Tap to Place

This example demonstrates how to create a simple **tap-to-place** interaction, allowing users to tap on the ground to spawn a 3D object.

### Component

#### tap-place

This component listens for tap events and uses raycasting to detect where the user taps on the ground, then creates an instance of a prefab at that location.

### How It Works

1. The user taps the ground.
2. The component raycasts from the camera to find the intersection point.
3. A prefab is instantiated at that position.

---

# Cursor Tap to Place + Gesture Detection

This example demonstrates **interactive object placement and manipulation** using two components working together in the same scene.  
Users can tap to place an object on the ground and then move, rotate, or scale it using touch gestures.

---

### Component: cursor-tap-place

This component detects tap input on the ground and positions a selected entity using 8th Wall’s native raycasting system.  
It includes parameters for cursor movement, hover height, and growth animations when placing objects.

#### How It Works

1. The camera performs a raycast to locate the ground surface.
2. The cursor entity smoothly moves toward the detected point.
3. When the user taps, the placed object moves to the cursor’s position.
4. Optional easing animations scale the object into view.

#### Configuration

- **cursorEntity** – Follows the detected placement point.
- **groundEntity** – Defines the placement surface.
- **placedEntity** – The object to move or instantiate.
- **yHeight** – Height offset for cursor placement.
- **growOnPlace** – Enables scale-up animation.
- **growSpeed / easingFunction** – Controls animation speed and curve.

Attach the **cursor-tap-place** component to the Camera entity and configure its properties in the Inspector Panel.

---

### Component: gesture-detection

This component adds multi-touch gesture controls to any interactive entity, enabling **hold-drag**, **two-finger rotation**, and **pinch-to-scale** within the same scene as **cursor-tap-place**.

#### How It Works

1. **Hold-Drag:** Long-press to move an object across the ground plane.
2. **Two-Finger Rotation:** Move two fingers horizontally to rotate the object around its Y-axis.
3. **Pinch-to-Scale:** Pinch inward or outward to resize the object within defined limits.  
   A built-in state machine manages gesture transitions and ensures smooth blending between gestures.

#### Configuration

- **groundEntity** – Plane used for drag raycasting.
- **holdDrag** – Enables/disables hold-drag.
- **twoFingerRotation** – Enables/disables rotation.
- **pinchScale** – Enables/disables scaling.
- **rotationFactor** – Adjusts rotation sensitivity.
- **minScale / maxScale** – Defines scaling limits.
- **dragDelay / smoothness** – Configures delay and interpolation speed.

Attach the **gesture-detection** component to any entity you want to make interactive, then configure its settings in the Inspector Panel.

---

# Absolute Scale

![](https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExdjU1cDFsM2RscmlseWJpeXpucmYwZTlycWl2N3Jua21leHY0YWVmdCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Y3ap0QiLAvPcPLpOLt/giphy.gif)

**Absolute Scale** enables cross-platform, real-world-scale AR in 8th Wall Studio.  
When enabled, virtual content appears at true physical size relative to the user’s device height.

### How It Works

1. Set the Camera Type to **World** and Scale Mode to **Absolute**.
2. The 8th Wall Engine estimates scale based on device movement and camera height.
3. The **Coaching Overlay** guides users through the motion required to calibrate scale.
4. 3D content is rendered at a 1:1 scale in the real world.

### Configuration

- Models should be built at real-world scale in your 3D software.
- Add objects as children of the **scene** entity.
- Use the **Coaching Overlay** pipeline module to assist users with calibration.

---

### Attribution

Tree by Poly by Google [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/) via [Poly Pizza](https://poly.pizza/m/6pwiq7hSrHr)
