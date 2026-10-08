import { assert } from "chai";
import { canTransition } from "../src/domain/jobs/transitions";

describe("job transitions", () => {
  it("allows the happy path", () => {
    const path = ["CREATED", "FUNDED", "IN_PROGRESS", "SUBMITTED", "VERIFIED", "SETTLED"] as const;
    for (let i = 0; i < path.length - 1; i++) {
      assert.isTrue(canTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]}`);
    }
  });

  it("allows rejection and resubmission", () => {
    assert.isTrue(canTransition("SUBMITTED", "REJECTED"));
    assert.isTrue(canTransition("REJECTED", "SUBMITTED"));
  });

  it("rejects invalid transitions", () => {
    assert.isFalse(canTransition("CREATED", "VERIFIED"));
    assert.isFalse(canTransition("FUNDED", "SETTLED"));
    assert.isFalse(canTransition("VERIFIED", "FUNDED"));
    assert.isFalse(canTransition("SETTLED", "IN_PROGRESS"));
    assert.isFalse(canTransition("REJECTED", "SETTLED"));
    assert.isFalse(canTransition("SUBMITTED", "SETTLED"));
  });
});
