// This is a component file. You can use this file to define a custom component for your project.
// This component will appear as a custom component in the editor.

import * as ecs from '@8thwall/ecs'  // This is how you access the ecs library.

ecs.registerComponent({
  name: 'Coaching Overlay',
  schema: {
    scene: ecs.eid,
  },
  stateMachine: ({world, eid, schemaAttribute}) => {
    ecs.defineState('default')
      .initial()
      .listen(world.events.globalId, ecs.events.REALITY_TRACKING_STATUS, (e) => {
        const {scene} = schemaAttribute.get(eid)

        if (e.data.status === 'LIMITED') {
        // show coaching overlay, hide scene
          ecs.Hidden.remove(world, eid)
          ecs.Hidden.set(world, scene)
        } else if (e.data.status === 'NORMAL') {
        // hide coaching overlay, show scene
          ecs.Hidden.set(world, eid)
          ecs.Hidden.remove(world, scene)
        }
      })
  },
})
