@directory:jev-benchmark a big change in the benchmark architecture Now we will call it Dreaming 
We will have two mode button, Run Jev and Compare Jev

1. The Run Jev pipeline will work this way 

Stage 1 Jev classfier - This was take in 10 chunks at once  ask questions in these format

{
    "model": "jev-latest",
    "state": {
        "chunks": [
            "This document is provided for internal use only. Unauthorized distribution, copying, or reproduction of any part of this document is strictly prohibited without prior written consent. All trademarks, logos, and brand names mentioned herein are the property of their respective owners. For questions regarding this document, please contact the documentation team. Last reviewed: Q3 2026. Version history is maintained in the internal changelog and is not reproduced here for brevity.",
            "We decided to replace Docling with pymupdf and pymupdf4llm for PDF parsing in the ingestion pipeline. The switch was driven by six architectural concerns raised in review, primarily around memory overhead on large documents and the lack of fine-grained control over table extraction. pymupdf4llm gives us markdown-formatted output directly, which simplifies the downstream chunking step since we no longer need a separate HTML-to-markdown conversion pass.",
            "As mentioned above, this change affects every document type that previously went through the old parser, not just PDFs. Teams relying on the legacy output format should note that the field names differ slightly going forward. The rest of this section describes how to migrate existing integrations to the new format.",
            "Table of Contents 1. Overview .......... 2 2. Architecture ....... 5 3. Ingestion Pipeline .. 9 4. Chunking Strategy .. 14 5. Memory Extraction .. 20 6. Deployment ......... 27 Appendix A: Config Reference .. 31 Appendix B: Glossary .......... 35"
        ],
        "rubrics" : {
            "question" : "Does this chunk contains a standalone fact, decision, preference, or state change worth remembering as a long-term memory or if it contains information a neighboring chunk needs to be correctly interpreted",
            "focus" : "Defines a term, names an entity, resolves a pronoun or reference used nearby.",
            "true" : "The chunk contains useful information to remember or contains relevant inforamtion that the neighbouring chunks will need",
            "false" : "The chunk is boilerplate, navigation/headers, empty, purely structural, or generic filler with no standalone or referential value."
        }
    },
    "questions": {
        "chunk_0": {
            "type": "noul",
            "instructions": {
                "question": "`rubrics.question`",
                "focus": "`rubrics.focus`",
                "chunk": "`chunks[0]`"
            },
            "criteria": {
                "true": "`rubrics.true`",
                "false": "`rubrics.false`"
            }
        },
        "chunk_1": {
            "type": "noul",
            "instructions": {
                "question": "`rubrics.question`",
                "focus": "`rubrics.focus`",
                "chunk": "`chunks[1]`"
            },
            "criteria": {
                "true": "`rubrics.true`",
                "false": "`rubrics.false`"
            }
        },
        "chunk_2": {
            "type": "noul",
            "instructions": {
                "question": "`rubrics.question`",
                "focus": "`rubrics.focus`",
                "chunk": "`chunks[2]`"
            },
            "criteria": {
                "true": "`rubrics.true`",
                "false": "`rubrics.false`"
            }
        },
        "chunk_3": {
            "type": "noul",
            "instructions": {
                "question": "`rubrics.question`",
                "focus": "`rubrics.focus`",
                "chunk_0": "`chunks[3]`"
            },
            "criteria": {
                "true": "`rubrics.true`",
                "false": "`rubrics.false`"
            }
        }
    }
}

Stage 2 Memory generation - We take in the chunks to llm to generate atomic memories with their type like episodic , fact , procedural etc

Stage 3 building knowledege graph (or if you have a better name for this then give it) - In this stage we take the newly generated memories , use that to fetch realted top-k memories , then pass that to jev to check what action is needed to be performed on the new memory 

example
{
    "model": "jev-latest",
    "state": {
        "new_claim": "Adnan is planning to move to Tokyo",
        "existing_memories": [
            "Adnan Lives in Nagpur",
            "Adnan does not like Tokyo",
            "User is planning to learn JS"
        ],
        "rubrics": {
            "instructions": {
                "focus": "Judge only the relationship between these two specific statements. Do not use outside knowledge assumptions about what one fact usually implies about another — decide based only on what is explicitly stated in both."
            },
            "Unrelated": {
                "what": "The new claim and the existing memory concern different subjects, entities, or facts, with no meaningful semantic relationship.",
                "not_for": "Cases where the claims share a subject or entity and the new claim adds, changes, or describes the state of something already represented by the existing memory. Those cases belong to Append, Extend, or Supersede."
            },
            "Append": {
                "what": "The new claim restates the same fact already represented by the existing memory — same subject, same attribute, same value, and same relevant time or state — without adding any materially new information.",
                "not_for": "A claim that adds new detail, context, scope, or a related state (use Extend), or a claim that changes the value of the same attribute in the same relevant temporal context (use Supersede)."
            },
            "Extend": {
                "what": "The new claim adds materially new information related to the existing memory. It may add detail, context, scope, or describe a related past, present, or future state of the same subject or attribute. The existing memory remains valid and both claims can be true at the same time.",
                "not_for": "A claim that merely restates the existing fact (use Append), or a claim that asserts the existing state has actually been replaced or changed in the same relevant temporal context (use Supersede)."
            },
            "Supersede": {
                "what": "The new claim changes or replaces the value of the same attribute or state represented by the existing memory, within the same relevant temporal context, such that the old and new states cannot both represent the current truth.",
                "not_for": "A claim describing a future plan, intention, possibility, or temporary/future state that has not yet replaced the existing state. Such claims should use Extend."
            }
        }
    },
    "questions": {
        "existing_memories[0]": {
            "type": "choice",
            "instructions": {
                "question": "How does the `new_claim` relate to this `existing_memory[0]`?",
                "focus": "`rubrics.instructions.focus`"
            },
            "criteria": {
                "Unrelated": {
                    "what": "`rubrics.Unrelated.what",
                    "not_for": "`rubrics.Unrelated.not_for`"
                },
                "Append": {
                    "what": "`rubrics.Append.what",
                    "not_for": "`rubrics.Append.not_for`"
                },
                "Extend": {
                    "what": "`rubrics.Extend.what",
                    "not_for": "`rubrics.Extend.not_for`"
                },
                "Supersede": {
                    "what": "`rubrics.Supersede.what",
                    "not_for": "`rubrics.Supersede.not_for`"
                }
            }
        },
        "existing_memories[1]": {
            "type": "choice",
            "instructions": {
                "question": "How does the `new_claim` relate to this `existing_memory[1]`?",
                "focus": "`rubrics.instructions.focus`"
            },
            "criteria": {
                "Unrelated": {
                    "what": "`rubrics.Unrelated.what",
                    "not_for": "`rubrics.Unrelated.not_for`"
                },
                "Append": {
                    "what": "`rubrics.Append.what",
                    "not_for": "`rubrics.Append.not_for`"
                },
                "Extend": {
                    "what": "`rubrics.Extend.what",
                    "not_for": "`rubrics.Extend.not_for`"
                },
                "Supersede": {
                    "what": "`rubrics.Supersede.what",
                    "not_for": "`rubrics.Supersede.not_for`"
                }
            }
        },
        "existing_memories[2]": {
            "type": "choice",
            "instructions": {
                "question": "How does the `new_claim` relate to this `existing_memory[2]`?",
                "focus": "`rubrics.instructions.focus`"
            },
            "criteria": {
                "Unrelated": {
                    "what": "`rubrics.Unrelated.what",
                    "not_for": "`rubrics.Unrelated.not_for`"
                },
                "Append": {
                    "what": "`rubrics.Append.what",
                    "not_for": "`rubrics.Append.not_for`"
                },
                "Extend": {
                    "what": "`rubrics.Extend.what",
                    "not_for": "`rubrics.Extend.not_for`"
                },
                "Supersede": {
                    "what": "`rubrics.Supersede.what",
                    "not_for": "`rubrics.Supersede.not_for`"
                }
            }
        }
    }
}




1. The Compare Jev pipeline - 

This will run both pipeline one with jev and another with gemini for comparison 


I already described the jev pipeline how it will work, so for gemini we will run similar kind of pipeline but instead of jev we will use gemini for all the task

Stage 1 - Sending all the chunks to llm for memory generation.
Stage 2 - Retrive top-k realted memories using newly generated memories and send that to an llm for mutation and then perform the mutation 


Then after each pipeline our evalution pipeline automatically runs on 3.8 flash that passes all the important data which check if the correct chunks were dropped and if the memories that we generated were correct and the mutations operatons that we performed was also correct , each having their own score and a overall score and review. So with this an LLM can evaluate both the approach with cost latency and accuracy.

To calculate your cost accurately, you need to look at
## 1. The Key for total token Cost
Look at total_tokens.


and calculate latency using performace.now(), keep jev connection warmed up to avoid tcp and ssl handshake slowdown.


as for the Conflict & Update Resolver and Past Memory Filter settings part, we dont need them anymore

rest everything is already in place like ui , dataset and all.


