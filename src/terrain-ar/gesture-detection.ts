import * as ecs from '@8thwall/ecs'  // Import the 8th Wall ECS library

// Register a comprehensive gesture handling component for touch interactions
// This component provides three main gesture types: hold-drag, two-finger rotation, and pinch-to-scale
ecs.registerComponent({
  name: 'gesture-detection',  // Component name for multi-touch gesture handling
  schema: {
    // === GESTURE TYPE TOGGLES ===
    // These boolean flags allow you to enable/disable specific gesture types
    twoFingerDrag: ecs.boolean,  // Enable two-finger rotation around Y-axis
    holdDrag: ecs.boolean,       // Enable hold-and-drag movement on ground plane
    pinchScale: ecs.boolean,     // Enable pinch-to-scale (zoom in/out)

    // === GROUND REFERENCE ===
    // Ground entity for raycasting - used to determine where to place objects during hold-drag
    groundEntity: ecs.eid,  // The ground plane entity for intersection calculations

    // === TWO-FINGER ROTATION SETTINGS ===
    // Controls how sensitive the rotation is to finger movement
    rotationFactor: ecs.f32,  // Multiplier for rotation sensitivity (higher = more sensitive)

    // === HOLD DRAG SETTINGS ===
    // Controls the delay before hold-drag activates
    dragDelay: ecs.i32,  // Milliseconds to hold before drag mode activates

    // === PINCH SCALE SETTINGS ===
    // Define the scaling limits and sensitivity for pinch gestures
    minScale: ecs.f32,     // Minimum allowed scale (prevents objects from becoming too small)
    maxScale: ecs.f32,     // Maximum allowed scale (prevents objects from becoming too large)
    scaleFactor: ecs.f32,  // Scaling sensitivity multiplier (currently unused but available)

    // === SMOOTHING SETTINGS ===
    // These control how smooth the animations are (lower = smoother, higher = more responsive)
    dragSmoothness: ecs.f32,      // Smoothing factor for hold-drag movement interpolation
    rotationSmoothness: ecs.f32,  // Smoothing factor for rotation interpolation (currently unused)
  },
  // Default values for the component's schema - optimized for good user experience
  schemaDefaults: {
    twoFingerDrag: true,       // Enable two-finger rotation by default
    holdDrag: true,            // Enable hold-drag by default
    pinchScale: true,          // Enable pinch scaling by default
    rotationFactor: 3.0,       // Moderate rotation sensitivity
    dragDelay: 300,            // 300ms hold delay before drag activates
    minScale: 0.3,             // Prevent objects from becoming too small (30% of original)
    maxScale: 8.0,             // Prevent objects from becoming too large (800% of original)
    scaleFactor: 2.0,          // Scaling sensitivity (currently unused)
    dragSmoothness: 0.15,      // Smooth but responsive drag movement
    rotationSmoothness: 0.12,  // Smooth rotation (currently unused - rotations are immediate)
  },
  // Internal data storage for gesture state management and smooth animations
  data: {
    // === GENERAL GESTURE STATE ===
    currentGesture: ecs.string,  // Tracks current active gesture: 'none', 'holdDrag', 'twoFinger', 'dropping'

    // === HOLD DRAG STATE MANAGEMENT ===
    holdTimer: ecs.i32,       // Timer ID for hold detection (cleared if touch ends early)
    isDragging: ecs.boolean,  // Flag indicating if object is currently being dragged
    lastTouchX: ecs.f32,      // Last recorded touch X position (currently unused)
    lastTouchY: ecs.f32,      // Last recorded touch Y position (currently unused)
    dragStartY: ecs.f32,      // Original Y position before drag started (for returning to ground)

    // === HOLD DRAG SMOOTH INTERPOLATION STATE ===
    // These values enable smooth movement instead of jerky position updates
    targetX: ecs.f32,   // Target X position for smooth interpolation
    targetY: ecs.f32,   // Target Y position for smooth interpolation
    targetZ: ecs.f32,   // Target Z position for smooth interpolation
    currentX: ecs.f32,  // Current interpolated X position
    currentY: ecs.f32,  // Current interpolated Y position
    currentZ: ecs.f32,  // Current interpolated Z position

    // === TWO-FINGER ROTATION STATE ===
    lastAngle: ecs.f32,         // Previous rotation angle for delta calculations (currently unused)
    rotationY: ecs.f32,         // Accumulated Y-axis rotation (currently unused)
    targetRotationY: ecs.f32,   // Target rotation for smooth interpolation (currently unused)
    currentRotationY: ecs.f32,  // Current Y-axis rotation value (applied immediately)

    // === PINCH SCALE STATE ===
    // These values track the scaling gesture and maintain scale consistency
    initialSpread: ecs.f32,  // Distance between fingers when pinch gesture started
    initialScale: ecs.f32,   // Object's scale when pinch gesture started
  },
  // Define the state machine that manages gesture detection and handling
  stateMachine: ({world, eid, schemaAttribute, dataAttribute, defineState}) => {
    // Define triggers for transitioning between different gesture states
    const toHoldDrag = ecs.defineTrigger()   // Trigger when hold-drag is detected
    const toTwoFinger = ecs.defineTrigger()  // Trigger when two-finger gesture starts
    const toDropping = ecs.defineTrigger()   // Trigger when hold-drag ends (smooth return to ground)
    const toWaiting = ecs.defineTrigger()    // Trigger to return to waiting state

    // === WAITING STATE ===
    // This is the initial state that listens for gesture starts and manages gesture detection
    defineState('waiting')
      .initial()  // This is the default starting state
      .onEnter(() => {
        // Initialize all data values when entering the waiting state
        // This ensures clean state for gesture detection
        const currentScale = ecs.Scale.get(world, eid)

        dataAttribute.set(eid, {
          currentGesture: 'none',        // No active gesture
          holdTimer: 0,                  // No active hold timer
          isDragging: false,             // Not currently dragging
          lastTouchX: 0,                 // Reset touch tracking
          lastTouchY: 0,
          dragStartY: 0,                 // Reset drag start position
          lastAngle: 0,                  // Reset rotation tracking
          rotationY: 0,
          targetRotationY: 0,
          currentRotationY: 0,           // Reset current rotation
          initialSpread: 0,              // Reset pinch gesture tracking
          initialScale: currentScale.x,  // Store current scale for pinch calculations
          targetX: 0,                    // Reset smooth interpolation targets
          targetY: 0,
          targetZ: 0,
          currentX: 0,                   // Reset smooth interpolation current values
          currentY: 0,
          currentZ: 0,
        })

        // Component initialized and ready for gesture detection
      })

      // Listen for touch start events specifically on this entity (for hold-drag detection)
      .listen(eid, ecs.input.SCREEN_TOUCH_START, (event) => {
        const schema = schemaAttribute.get(eid)
        const data = dataAttribute.cursor(eid)

        // Only proceed if hold-drag is enabled in the schema
        if (!schema.holdDrag) return

        // Hold drag detection timer started

        // Start a timer that will trigger hold-drag mode after the specified delay
        // If the user lifts their finger before this timer expires, hold-drag won't activate
        data.holdTimer = world.time.setTimeout(() => {
          toHoldDrag.trigger()  // Transition to hold-drag state after delay
        }, schema.dragDelay)
      })

      // Listen for multi-touch gesture start events (globally, not just on this entity)
      .listen(world.events.globalId, ecs.input.GESTURE_START, (event) => {
        const gestureData = event.data as any
        const schema = schemaAttribute.get(eid)
        const data = dataAttribute.cursor(eid)

        // Check if this is a two-finger gesture and if two-finger features are enabled
        if (gestureData.touchCount === 2 && (schema.twoFingerDrag || schema.pinchScale)) {
          // Two-finger gesture detected

          // Store the initial distance between fingers for pinch-scale calculations
          // This baseline is used to determine how much the user has pinched in/out
          data.initialSpread = gestureData.spread

          toTwoFinger.trigger()  // Transition to two-finger gesture state
        }
      })

      // Listen for touch end events to clean up hold-drag detection
      .listen(world.events.globalId, ecs.input.SCREEN_TOUCH_END, (event) => {
        const data = dataAttribute.cursor(eid)

        // If the user lifts their finger before the hold timer expires,
        // cancel the hold-drag detection to prevent unwanted activation
        if (data.holdTimer !== 0) {
          world.time.clearTimeout(data.holdTimer)  // Cancel the pending hold-drag activation
          data.holdTimer = 0                       // Reset timer ID
          // Hold timer cleared - drag not activated
        }
      })

      // Define state transitions from the waiting state
      .onTrigger(toHoldDrag, 'holdDrag')    // Go to hold-drag when timer expires
      .onTrigger(toTwoFinger, 'twoFinger')  // Go to two-finger when multi-touch detected
      .onTrigger(toDropping, 'dropping')    // Go to dropping (shouldn't happen from waiting)

    // === HOLD DRAG STATE ===
    // This state is active when the user is performing a hold-drag gesture
    // The object smoothly lifts off the ground and follows the user's finger movement
    defineState('holdDrag')
      .onEnter(() => {
        const data = dataAttribute.cursor(eid)

        // Set flags to indicate we're in active drag mode
        data.isDragging = true
        data.currentGesture = 'holdDrag'

        // Capture the entity's current world position when drag starts
        // This is important for knowing where to return the object when drag ends
        const currentWorldPos = world.transform.getWorldPosition(eid)
        data.dragStartY = currentWorldPos.y  // Store original ground position

        // Initialize the smooth interpolation system with current position
        // This prevents jarring jumps when the drag starts
        data.currentX = currentWorldPos.x
        data.currentY = currentWorldPos.y
        data.currentZ = currentWorldPos.z

        // Set target position to lift the object slightly above its current position
        // This visual feedback shows the user that the object is now "picked up"
        data.targetX = currentWorldPos.x
        data.targetY = currentWorldPos.y + 0.2  // Lift by 0.2 units
        data.targetZ = currentWorldPos.z

        // Hold drag activated - object will lift and follow finger movement
      })

      // Smooth interpolation system - runs every frame while in hold-drag state
      // This creates smooth, fluid movement instead of jerky position updates
      .onTick(() => {
        const schema = schemaAttribute.get(eid)
        const data = dataAttribute.cursor(eid)

        // Check if we need to continue smoothing the position
        // We smooth if actively dragging OR if we haven't reached the target position yet
        const needsPositionSmoothing = data.isDragging ||
          Math.abs(data.currentY - data.targetY) > 0.01 ||  // Still moving vertically
          Math.abs(data.currentX - data.targetX) > 0.01 ||  // Still moving horizontally X
          Math.abs(data.currentZ - data.targetZ) > 0.01     // Still moving horizontally Z

        if (!needsPositionSmoothing) return  // Skip if no smoothing needed

        // Apply smooth interpolation using linear interpolation (lerp)
        // The smoothness factor controls how quickly we approach the target
        const positionSmoothness = schema.dragSmoothness

        // Move current position closer to target position by the smoothness factor
        data.currentX += (data.targetX - data.currentX) * positionSmoothness
        data.currentY += (data.targetY - data.currentY) * positionSmoothness
        data.currentZ += (data.targetZ - data.currentZ) * positionSmoothness

        // Apply the smoothed position to the entity's world transform
        world.transform.setWorldPosition(eid, {
          x: data.currentX,
          y: data.currentY,
          z: data.currentZ,
        })
      })

      // Handle touch move events during hold-drag to update object position
      // This is the core logic that makes the object follow the user's finger
      .listen(world.events.globalId, ecs.input.SCREEN_TOUCH_MOVE, (event) => {
        const touchData = event.data as any
        const schema = schemaAttribute.get(eid)
        const data = dataAttribute.cursor(eid)

        // Extract normalized screen coordinates from the touch event
        // These coordinates range from 0 to 1 across the screen
        const screenPosition = touchData.position
        if (!screenPosition) {
          return
        }

        // Find the active camera in the Three.js scene
        // We need this to create a ray from the camera through the touch point
        const {THREE} = window as any
        let cameraObj: any = null
        world.three.scene.traverse((c: any) => {
          if (c.isCamera && !cameraObj) cameraObj = c
        })

        if (!cameraObj) {
          return
        }

        // Convert normalized screen coordinates (0-1) to NDC coordinates (-1 to 1)
        // NDC (Normalized Device Coordinates) are required for Three.js raycasting
        const ndcX = touchData.position.x * 2 - 1
        const ndcY = -(touchData.position.y * 2 - 1)  // Flip Y axis for NDC

        // NDC coordinates calculated for raycasting

        // Create a raycaster that shoots a ray from the camera through the touch point
        // This ray will intersect with the ground to determine where to place the object
        const raycaster = new THREE.Raycaster()
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cameraObj)

        // Get the Three.js object for the ground entity so we can intersect with it
        const groundObject = world.three.entityToObject.get(schema.groundEntity)
        if (!groundObject) {
          return
        }

        // Perform the raycast intersection with the ground plane
        // This tells us exactly where on the ground the user is pointing
        const intersects = raycaster.intersectObject(groundObject, true)

        if (intersects.length > 0) {
          // We found an intersection! Get the world position where the ray hit the ground
          const intersection = intersects[0]
          const worldPos = intersection.point

          // Update the target position for smooth interpolation
          // Keep the object lifted above the ground during drag (dragStartY + 0.2)
          data.targetX = worldPos.x             // Move to touch X position
          data.targetY = data.dragStartY + 0.2  // Keep lifted above original ground position
          data.targetZ = worldPos.z             // Move to touch Z position
        }
      })

      // Handle touch end events to finish the hold-drag gesture
      .listen(world.events.globalId, ecs.input.SCREEN_TOUCH_END, (event) => {
        const data = dataAttribute.cursor(eid)

        // Hold drag ended - object will smoothly return to ground

        // Set target position to smoothly lower back to original Y position
        // This creates a smooth "dropping" animation back to the ground
        data.targetX = data.currentX    // Keep current X position where user left it
        data.targetY = data.dragStartY  // Return to original Y position (ground level)
        data.targetZ = data.currentZ    // Keep current Z position where user left it

        toDropping.trigger()  // Transition to dropping state for smooth landing
      })

      .onExit(() => {
        // Clean up hold-drag state when leaving this state
        const data = dataAttribute.cursor(eid)
        data.isDragging = false
        data.currentGesture = 'none'
      })

      .onTrigger(toDropping, 'dropping')  // Transition to dropping state

    // === DROPPING STATE ===
    // This state smoothly animates the object back to the ground after hold-drag ends
    // It continues the smooth interpolation until the object reaches its final position
    defineState('dropping')
      .onEnter(() => {
        const data = dataAttribute.cursor(eid)
        data.currentGesture = 'dropping'

        // Dropping state - object will smoothly return to ground
      })

      // Continue smooth interpolation until the object reaches the ground
      // This creates a natural "dropping" animation after the user releases their finger
      .onTick(() => {
        const schema = schemaAttribute.get(eid)
        const data = dataAttribute.cursor(eid)

        // Check if we still need to smooth the position to reach the target
        // We continue until the object is very close to its target position
        const needsPositionSmoothing =
          Math.abs(data.currentY - data.targetY) > 0.01 ||  // Still dropping vertically
          Math.abs(data.currentX - data.targetX) > 0.01 ||  // Still adjusting horizontally X
          Math.abs(data.currentZ - data.targetZ) > 0.01     // Still adjusting horizontally Z

        if (!needsPositionSmoothing) {
          // Object has reached its final position, return to waiting state
          // Object has reached ground - returning to waiting state
          toWaiting.trigger()
          return
        }

        // Continue the smooth interpolation using the same smoothness factor
        // This ensures consistent animation speed between hold-drag and dropping
        const positionSmoothness = schema.dragSmoothness

        // Apply linear interpolation to smoothly approach the target position
        data.currentX += (data.targetX - data.currentX) * positionSmoothness
        data.currentY += (data.targetY - data.currentY) * positionSmoothness
        data.currentZ += (data.targetZ - data.currentZ) * positionSmoothness

        // Update the entity's world position with the smoothed values
        world.transform.setWorldPosition(eid, {
          x: data.currentX,
          y: data.currentY,
          z: data.currentZ,
        })
      })

      .onExit(() => {
        // Clean up dropping state and log completion
        const data = dataAttribute.cursor(eid)
        data.currentGesture = 'none'
        // Object has been placed on ground
      })

      .onTrigger(toWaiting, 'waiting')  // Return to waiting state when dropping is complete

    // === TWO FINGER STATE ===
    // This state handles two-finger gestures: rotation and pinch-to-scale
    // Unlike hold-drag, these gestures apply changes immediately without smoothing for responsiveness
    defineState('twoFinger')
      .onEnter(() => {
        const data = dataAttribute.cursor(eid)
        const schema = schemaAttribute.get(eid)

        data.currentGesture = 'twoFinger'

        // Initialize two-finger rotation tracking if enabled
        if (schema.twoFingerDrag) {
          data.lastAngle = 0  // Reset angle tracking for rotation calculations
          // Two-finger rotation detection active
        }

        // Initialize pinch-to-scale tracking if enabled
        if (schema.pinchScale) {
          // Store the current scale as the baseline for pinch calculations
          data.initialScale = ecs.Scale.get(world, eid).x
          // Pinch scale active
        }
      })

      // Handle gesture movement events for real-time two-finger interactions
      // These apply immediately without smoothing for responsive feel
      .listen(world.events.globalId, ecs.input.GESTURE_MOVE, (event) => {
        const gestureData = event.data as any
        const schema = schemaAttribute.get(eid)
        const data = dataAttribute.cursor(eid)

        // === TWO-FINGER ROTATION HANDLING (delta, additive) ===
        if (schema.twoFingerDrag && gestureData.touchCount === 2 && gestureData.positionChange) {
          // Horizontal movement → yaw delta (radians)
          const rotationDelta = (gestureData.positionChange.x ?? 0) * schema.rotationFactor
          if (rotationDelta === 0) return

          // Convert delta angle to a quaternion around local Y
          const half = rotationDelta * 0.5
          const dy = Math.sin(half)
          const dw = Math.cos(half)

          // Apply incremental rotation in LOCAL space (keeps existing orientation intact)
          world.transform.rotateSelf(eid, {x: 0, y: dy, z: 0, w: dw})
        }

        // === PINCH-TO-SCALE HANDLING ===
        // Scale the object based on the distance between two fingers
        if (schema.pinchScale && gestureData.spread !== undefined && data.initialSpread > 0 && gestureData.touchCount === 2) {
          // Calculate scale ratio based on finger spread change
          const scaleRatio = gestureData.spread / data.initialSpread
          let newScale = data.initialScale * scaleRatio

          // Clamp the scale to prevent objects from becoming too small or too large
          newScale = Math.max(schema.minScale, Math.min(schema.maxScale, newScale))

          // Apply the new scale immediately to all axes (uniform scaling)
          ecs.Scale.set(world, eid, {
            x: newScale,
            y: newScale,
            z: newScale,
          })

          // Pinch scale applied
        }
      })

      // Handle the end of two-finger gestures
      .listen(world.events.globalId, ecs.input.GESTURE_END, (event) => {
        const gestureData = event.data as any
        const data = dataAttribute.cursor(eid)

        // Update the initial scale for the next pinch gesture
        // This ensures consistent scaling behavior across multiple pinch gestures
        if (ecs.Scale.has(world, eid)) {
          data.initialScale = ecs.Scale.get(world, eid).x
        }

        // Reset the initial spread for the next pinch gesture
        data.initialSpread = 0

        toWaiting.trigger()  // Return to waiting state for new gesture detection
      })

      .onExit(() => {
        // Clean up two-finger gesture state
        const data = dataAttribute.cursor(eid)
        data.currentGesture = 'none'
      })

      .onTrigger(toWaiting, 'waiting')  // Transition back to waiting state
  },

  // Cleanup function called when the component is removed from an entity
  // This ensures proper cleanup of timers and prevents memory leaks
  remove: (world, component) => {
    const {dataAttribute, eid} = component

    // Clear any active hold timer to prevent it from firing after component removal
    if (dataAttribute.get(eid).holdTimer !== 0) {
      world.time.clearTimeout(dataAttribute.get(eid).holdTimer)
    }

    // Gesture components removed and cleaned up
  },
})
