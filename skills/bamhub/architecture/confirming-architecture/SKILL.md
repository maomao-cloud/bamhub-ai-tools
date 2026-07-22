---                                                                                                                                                 
name: confirming-architecture                                                                                                                       
description: Use when a design direction exists, but implementation planning would still rely on unstated assumptions about boundaries, change      
surface, logic path, or architecture decisions
  ---                                                                                                                                                 

# Confirming Architecture

## Overview

Use this skill to stop architecture uncertainty from turning into implementation planning.                                                          
If a design/spec exists but the exact boundaries, change surface, key logic path, or design choices are still implicit, resolve those first before
moving into `writing-plans`.

This is a lightweight gate, not a full design phase and not an implementation plan.

## When to Use

  ```dot                                                                                                                                              
  digraph when_to_use {                                     
      "Design/spec exists?" [shape=diamond];                                                                                                          
      "Planning depends on unstated assumptions?" [shape=diamond];                                                                                    
      "Use confirming-architecture" [shape=box];                                                                                                      
      "Proceed to writing-plans" [shape=box];                                                                                                         
                                                                                                                                                      
      "Design/spec exists?" -> "Planning depends on unstated assumptions?" [label="yes"];                                                             
      "Planning depends on unstated assumptions?" -> "Use confirming-architecture" [label="yes"];                                                     
      "Planning depends on unstated assumptions?" -> "Proceed to writing-plans" [label="no"];                                                         
  }       
  ```                                                                                                                                           
                                                                                                                                                      
  Use when:                                                                                                                                           
  - A brainstorming/design discussion already produced a direction
  - The goal is clear, but the exact modules, boundaries, or logic path to change are still unclear                                                   
  - Multiple plausible implementation shapes still exist                                           
  - Writing a plan would require guessing architecture decisions                                                                                      
  - The user wants to confirm “what will change” before planning “how to build it”                                                                    
                                                                                                                                                      
  Do not use when:                                                                                                                                    
  - There is no design/spec yet                                                                                                                       
  - The architecture decision is already settled enough for planning                                                                                  
  - The work is already in implementation or code review                                                                                              
                                                                                                                                                      
  Core Rule                                                                                                                                           
                                                                                                                                                      
  Do not turn architecture uncertainty into implementation work.                                                                                      
                                                                                                                                                      
  If planning would rely on assumptions that have not been explicitly confirmed, stop and resolve them first.                                         
                                                            
  Goal clarity is not boundary clarity.                                                                                                               
  A valid design direction is not automatically a valid planning input.
                                                                                                                                                      
  Inputs                                                                                                                                              
                                                                                                                                                      
  Use whatever already exists:                                                                                                                        
  - Design/spec or a short summary of it                    
  - Relevant repository/system context                                                                                                                
  - Candidate change surface                                
  - Open architecture questions, if any                                                                                                               
                                                                                                                                                      
  Do not require upstream or downstream skills to be modified.                                                                                        
                                                                                                                                                      
  Output                                                                                                                                              
                                                                                                                                                      
  Produce a short architecture confirmation result with exactly these sections:                                                                       
                                                            
  Boundary                                                                                                                                            
                                                            
  - What this work includes                                                                                                                           
  - What it explicitly does not include                     
  - Where it stops relative to adjacent stages/components                                                                                             
                                                                                                                                                      
  Change Surface                                                                                                                                      
                                                                                                                                                      
  - Which skills, documents, scripts, modules, or flows are expected to change                                                                        
                                                            
  Key Patterns                                                                                                                                        
                                                            
  - Which design pattern / structure / ownership model is being chosen                                                                                
  - Why this is the right shape                             
  - Which obvious alternative is not being chosen                                                                                                     
                                                                                                                                                      
  Gate Decision                                                                                                                                       
                                                                                                                                                      
  - PASS — safe to move into writing-plans                                                                                                            
  - BLOCKED — planning should not begin yet                 
                                                                                                                                                      
  If BLOCKED, list the unresolved decisions blocking planning.                                                                                        
                                                                                                                                                      
  PASS Criteria                                                                                                                                       
                                                            
  Only return PASS when all of these are true:                                                                                                        
  - Boundaries are explicit enough to avoid scope drift     
  - Change surface is concrete enough to guide planning                                                                                               
  - Key design choices are explicit enough to avoid hidden assumptions
  - Remaining unknowns are small enough that they do not affect task decomposition                                                                    
                                                                                                                                                      
  Otherwise return BLOCKED.                                                                                                                           
                                                                                                                                                      
  Quick Reference                                                                                                                                     
                                                                                                                                                      
  ┌─────────────────────────────────────────────────────────┬─────────────────────────────────────────┐                                               
  │                        Situation                        │                 Action                  │
  ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────┤                                               
  │ Goal is clear but modules to change are unclear         │ Confirm change surface                  │
  ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────┤                                               
  │ There are 2-3 valid structural options                  │ Force an explicit choice                │                                               
  ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────┤                                               
  │ Planning would assume a design pattern                  │ Confirm the pattern first               │                                               
  ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────┤                                               
  │ User says “continue” but architecture is still implicit │ Block planning and confirm architecture │
  ├─────────────────────────────────────────────────────────┼─────────────────────────────────────────┤                                               
  │ Architecture is already settled                         │ Return PASS and move on                 │
  └─────────────────────────────────────────────────────────┴─────────────────────────────────────────┘                                               
                                                            
  Common Mistakes                                                                                                                                     
                                                            
  Mistake: Turning architecture questions into task breakdown                                                                                         
                                                            
  Wrong:                                                                                                                                              
  - “Let’s split this into 4 work packages and figure it out as we go.”
                                                                                                                                                      
  Better:
  - Confirm boundaries and design choices first, then plan.                                                                                           
                                                                                                                                                      
  Mistake: Treating a clear goal as a clear architecture                                                                                              
                                                                                                                                                      
  Wrong:                                                                                                                                              
  - “We know what we want, so we can write the implementation plan.”                                                                                  
                                                                                                                                                      
  Better:                                                   
  - Check whether planning still depends on unstated assumptions.                                                                                     
                                                                                                                                                      
  Mistake: Making this a second brainstorming phase                                                                                                   
                                                                                                                                                      
  Wrong:                                                                                                                                              
  - Re-opening broad ideation or redoing the whole design process.                                                                                    
                                                                                                                                                      
  Better:                                                   
  - Keep this focused on planning-critical architecture decisions only.                                                                               
                                                                                                                                                      
  Red Flags                                                                                                                                           
                                                                                                                                                      
  If you catch yourself thinking any of these, stop and confirm architecture first:                                                                   
  - “We can decide that during planning.”                                                                                                             
  - “Let’s just start with a task list.”                                                                                                              
  - “The exact boundary can be refined later.”              
  - “The goal is obvious, so the structure probably is too.”                                                                                          
  - “We can keep it lightweight by skipping explicit confirmation.”                                                                                   
                                                                                                                                                      
  All of these mean the architecture gate has not actually passed yet.                                                                                
                                                                                                                                                      
  Suggested Interaction Pattern                                                                                                                       
                                                                                                                                                      
  1. Restate the current design direction in one sentence                                                                                             
  2. Identify planning-critical unknowns                    
  3. Produce the 4-section confirmation result                                                                                                        
  4. Return PASS or BLOCKED                                                                                                                           
  5. Only after PASS, proceed to writing-plans