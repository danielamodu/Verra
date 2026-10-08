/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/proofpay.json`.
 */
export type Proofpay = {
  "address": "EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp",
  "metadata": {
    "name": "proofpay",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "ProofPay: verified field work → instant USDC settlement (V1 minimal protocol)"
  },
  "docs": [
    "V1 — minimal ProofPay protocol.",
    "",
    "State machine:",
    "CREATED -> FUNDED -> IN_PROGRESS -> SUBMITTED -> VERIFIED -> SETTLED",
    "SUBMITTED -> REJECTED -> IN_PROGRESS (resubmission loop)",
    "",
    "Roles:",
    "- business: creates + funds the job; pays USDC into escrow.",
    "- worker:   accepts + submits; receives USDC on settlement.",
    "- verifier: verifies / rejects; also acts as settlement authority for release.",
    "",
    "Escrow:",
    "- Associated Token Account (SPL Token) owned by the Job PDA.",
    "- Only `release_payment` can move funds out, via PDA-signed CPI,",
    "only from VERIFIED -> SETTLED, exactly once."
  ],
  "instructions": [
    {
      "name": "acceptJob",
      "docs": [
        "3. Worker accepts the job. FUNDED -> IN_PROGRESS."
      ],
      "discriminator": [
        43,
        201,
        124,
        1,
        19,
        189,
        96,
        10
      ],
      "accounts": [
        {
          "name": "worker",
          "signer": true
        },
        {
          "name": "job",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job.business",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "job.job_id",
                "account": "job"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "createJob",
      "docs": [
        "1. Business creates the job. Initializes the Job PDA in CREATED state."
      ],
      "discriminator": [
        178,
        130,
        217,
        110,
        100,
        27,
        82,
        119
      ],
      "accounts": [
        {
          "name": "business",
          "writable": true,
          "signer": true
        },
        {
          "name": "job",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "business"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "docs": [
            "USDC mint locked into the job at creation. All later token",
            "accounts must use this mint."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": "u64"
        },
        {
          "name": "worker",
          "type": "pubkey"
        },
        {
          "name": "verifier",
          "type": "pubkey"
        },
        {
          "name": "paymentAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fundJob",
      "docs": [
        "2. Business funds the job with USDC. CREATED -> FUNDED."
      ],
      "discriminator": [
        244,
        198,
        4,
        15,
        41,
        178,
        169,
        187
      ],
      "accounts": [
        {
          "name": "business",
          "writable": true,
          "signer": true
        },
        {
          "name": "job",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job.business",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "job.job_id",
                "account": "job"
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "docs": [
            "Mint must equal job.usdc_mint (checked in handler)."
          ]
        },
        {
          "name": "businessAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "business"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "escrowAta",
          "docs": [
            "Program-controlled escrow ATA, owned by the Job PDA.",
            "Created on first fund; holds exactly `payment_amount` until release."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "rejectJob",
      "docs": [
        "6. Verifier rejects completion. SUBMITTED -> REJECTED."
      ],
      "discriminator": [
        94,
        15,
        241,
        118,
        161,
        177,
        128,
        101
      ],
      "accounts": [
        {
          "name": "verifier",
          "signer": true
        },
        {
          "name": "job",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job.business",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "job.job_id",
                "account": "job"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "releasePayment",
      "docs": [
        "8. Settlement authority (verifier) releases escrow to worker.",
        "VERIFIED -> SETTLED. Exactly once. Worker can never pull escrow directly."
      ],
      "discriminator": [
        24,
        34,
        191,
        86,
        145,
        160,
        183,
        233
      ],
      "accounts": [
        {
          "name": "settlementAuthority",
          "docs": [
            "Settlement authority — must equal job.verifier (checked in handler)."
          ],
          "signer": true
        },
        {
          "name": "job",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job.business",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "job.job_id",
                "account": "job"
              }
            ]
          }
        },
        {
          "name": "escrowAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "job.usdc_mint",
                "account": "job"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "workerAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "resubmitJob",
      "docs": [
        "7. Worker re-queues after rejection. REJECTED -> IN_PROGRESS."
      ],
      "discriminator": [
        155,
        200,
        66,
        210,
        72,
        170,
        244,
        221
      ],
      "accounts": [
        {
          "name": "worker",
          "signer": true
        },
        {
          "name": "job",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job.business",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "job.job_id",
                "account": "job"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "submitJob",
      "docs": [
        "4. Worker submits completion. IN_PROGRESS -> SUBMITTED."
      ],
      "discriminator": [
        250,
        129,
        161,
        132,
        254,
        161,
        34,
        107
      ],
      "accounts": [
        {
          "name": "worker",
          "signer": true
        },
        {
          "name": "job",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job.business",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "job.job_id",
                "account": "job"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "verifyJob",
      "docs": [
        "5. Verifier approves completion. SUBMITTED -> VERIFIED."
      ],
      "discriminator": [
        235,
        103,
        8,
        177,
        140,
        20,
        135,
        67
      ],
      "accounts": [
        {
          "name": "verifier",
          "signer": true
        },
        {
          "name": "job",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job.business",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "job.job_id",
                "account": "job"
              }
            ]
          }
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "job",
      "discriminator": [
        75,
        124,
        80,
        203,
        161,
        180,
        202,
        80
      ]
    }
  ],
  "events": [
    {
      "name": "jobAccepted",
      "discriminator": [
        47,
        54,
        152,
        59,
        118,
        195,
        251,
        114
      ]
    },
    {
      "name": "jobCreated",
      "discriminator": [
        48,
        110,
        162,
        177,
        67,
        74,
        159,
        131
      ]
    },
    {
      "name": "jobFunded",
      "discriminator": [
        109,
        177,
        206,
        113,
        255,
        142,
        11,
        19
      ]
    },
    {
      "name": "jobRejected",
      "discriminator": [
        23,
        78,
        227,
        57,
        28,
        0,
        197,
        216
      ]
    },
    {
      "name": "jobResubmitted",
      "discriminator": [
        247,
        99,
        177,
        189,
        229,
        177,
        105,
        153
      ]
    },
    {
      "name": "jobSubmitted",
      "discriminator": [
        129,
        204,
        35,
        127,
        38,
        50,
        131,
        248
      ]
    },
    {
      "name": "jobVerified",
      "discriminator": [
        188,
        227,
        74,
        239,
        4,
        70,
        144,
        129
      ]
    },
    {
      "name": "paymentReleased",
      "discriminator": [
        160,
        132,
        155,
        232,
        46,
        254,
        69,
        219
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidStateTransition",
      "msg": "Invalid state transition for the current job state."
    },
    {
      "code": 6001,
      "name": "unauthorizedBusiness",
      "msg": "Only the business recorded at job creation may perform this action."
    },
    {
      "code": 6002,
      "name": "unauthorizedWorker",
      "msg": "Only the assigned worker may perform this action."
    },
    {
      "code": 6003,
      "name": "unauthorizedVerifier",
      "msg": "Only the assigned verifier may perform this action."
    },
    {
      "code": 6004,
      "name": "unauthorizedSettlement",
      "msg": "Only the authorized settlement authority (verifier) may release payment."
    },
    {
      "code": 6005,
      "name": "invalidMint",
      "msg": "Token mint does not match the USDC mint locked at job creation."
    },
    {
      "code": 6006,
      "name": "invalidPaymentAmount",
      "msg": "Payment amount must be greater than zero."
    },
    {
      "code": 6007,
      "name": "insufficientFunds",
      "msg": "Business token account holds insufficient funds for the payment amount."
    },
    {
      "code": 6008,
      "name": "amountMismatch",
      "msg": "Escrow balance does not match the locked payment amount."
    },
    {
      "code": 6009,
      "name": "prematureRelease",
      "msg": "Payment can only be released from VERIFIED state, exactly once."
    },
    {
      "code": 6010,
      "name": "invalidWorkerDestination",
      "msg": "Worker destination token account is not owned by the assigned worker."
    },
    {
      "code": 6011,
      "name": "invalidWorker",
      "msg": "Invalid worker pubkey."
    },
    {
      "code": 6012,
      "name": "invalidVerifier",
      "msg": "Invalid verifier pubkey."
    },
    {
      "code": 6013,
      "name": "workerCannotBeBusiness",
      "msg": "Worker cannot be the business itself."
    }
  ],
  "types": [
    {
      "name": "job",
      "docs": [
        "V1 job account. Fixed layout — do not reorder fields without a migration."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "jobId",
            "type": "u64"
          },
          {
            "name": "business",
            "type": "pubkey"
          },
          {
            "name": "worker",
            "type": "pubkey"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "paymentAmount",
            "type": "u64"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "jobState"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "jobAccepted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "jobId",
            "type": "u64"
          },
          {
            "name": "worker",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "jobCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "jobId",
            "type": "u64"
          },
          {
            "name": "business",
            "type": "pubkey"
          },
          {
            "name": "worker",
            "type": "pubkey"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "paymentAmount",
            "type": "u64"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "jobFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "jobId",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "jobRejected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "jobId",
            "type": "u64"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "jobResubmitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "jobId",
            "type": "u64"
          },
          {
            "name": "worker",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "jobState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "created"
          },
          {
            "name": "funded"
          },
          {
            "name": "inProgress"
          },
          {
            "name": "submitted"
          },
          {
            "name": "verified"
          },
          {
            "name": "rejected"
          },
          {
            "name": "settled"
          }
        ]
      }
    },
    {
      "name": "jobSubmitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "jobId",
            "type": "u64"
          },
          {
            "name": "worker",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "jobVerified",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "jobId",
            "type": "u64"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "paymentReleased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "jobId",
            "type": "u64"
          },
          {
            "name": "worker",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
