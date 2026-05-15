# Identify all paths

## From aggregate pages
```mermaid
graph TD
    ERROR
    AGG_START
    AGG_RESULT

    AGG_START -> ID[Aggregate IDs]
    
    ID ->|each| PE[Parse aggregate ID]
    ID ->|each| PAN[Parse aggregate name]
    
    PE ->|ok?| GAB[Get all blocks]
    PE ->|err?| ERROR
    
    GAB ->|each| PT[Parse block type]
    
    PT ->|link_to_page?| L[Link]
    PT ->|empty?| skip
    PT ->|other| ERROR

    L ->|standard page link?| PL[Page link]
    L -> |other| ERROR

    PL -> PID[Page ID]
    PL -> PN[Page name]

    PAN -> PP[Page path]
    PN -> PP

    PID -> AGG_RESULT
    PP -> AGG_RESULT
```
