# Identify all paths
```mermaid
graph TD
    ERROR
    START
    RESULT

    START -> AID[Aggregate IDs]
    
    AID ->|each| PE[Parse aggregate ID]
    AID ->|each| PAN[Parse aggregate name]
    
    PE ->|ok?| GAB[Get all blocks]
    PE ->|err?| ERROR
    
    GAB ->|each| PT[Parse block type]
    
    PT ->|link_to_page?| L[Link]
    PT ->|empty?| skip
    PT ->|other| ERROR

    L ->|page?| PL[Page link]
    L ->|db?| DL[Database link]
    L -> |other| ERROR

    PL -> PID[Page ID]
    PID -> PN[Page name]

    DL -> GAP[Get all page IDs]
    GAP ->|each| PID

    PAN -> PP[Page path]
    PN -> PP

    PID -> RESULT
    PP -> RESULT
```
