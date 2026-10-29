import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/grading-cases.json";
import {
  classifyCgpa,
  computeCgpa,
  computeGpa,
  DEGREE_CGPA_THRESHOLD,
  deriveGrade,
  GRADING_SCALE,
  isGradeImprovementEligible,
  round2,
} from "@/lib/grading";

describe("grading-cases fixtures (server)", () => {
  it("matches degreeCgpaThreshold", () => {
    expect(DEGREE_CGPA_THRESHOLD).toBe(fixtures.degreeCgpaThreshold);
  });

  describe("gradeDerivations", () => {
    for (const testCase of fixtures.gradeDerivations) {
      it(`derives ${testCase.marksObtained}/${testCase.maxMarks} (inc=${testCase.incomplete}) -> ${testCase.expected.letterGrade}`, () => {
        const derived = deriveGrade(testCase.marksObtained, testCase.maxMarks, testCase.incomplete);
        expect(derived.letterGrade).toBe(testCase.expected.letterGrade);
        expect(derived.gradePoint).toBe(testCase.expected.gradePoint);
        expect(derived.percentage).toBeCloseTo(testCase.expected.percentage, 2);
        expect(derived.status).toBe(testCase.expected.status);
        expect(derived.countsTowardGPA).toBe(testCase.expected.countsTowardGPA);
        expect(derived.countsAsEarnedCredit).toBe(testCase.expected.countsAsEarnedCredit);
      });
    }
  });

  describe("gpaComputations", () => {
    for (const comp of fixtures.gpaComputations) {
      it(comp.name, () => {
        const summary = computeGpa(comp.entries);
        expect(summary.gpa).toBe(comp.expected.gpa);
        expect(summary.totalCredits).toBe(comp.expected.totalCredits);
        expect(summary.totalWeightedPoints).toBe(comp.expected.totalWeightedPoints);
        expect(summary.coursesCounted).toBe(comp.expected.coursesCounted);
      });
    }
  });

  describe("cgpaProjections", () => {
    for (const proj of fixtures.cgpaProjections) {
      it(proj.name, () => {
        let baseWeightedPoints = proj.base.totalWeightedPoints;
        let baseCredits = proj.base.totalCredits;

        if ("retake" in proj && proj.retake) {
          baseWeightedPoints -= proj.retake.oldCredits * proj.retake.oldGradePoint;
          baseCredits -= proj.retake.oldCredits;
        }

        const addedSummary = computeGpa(proj.added);
        const finalWeighted = baseWeightedPoints + addedSummary.totalWeightedPoints;
        const finalCredits = baseCredits + addedSummary.totalCredits;
        const projectedCgpa = finalCredits === 0 ? null : round2(finalWeighted / finalCredits);

        expect(projectedCgpa).toBe(proj.expected.projectedCgpa);
        expect(finalCredits).toBe(proj.expected.projectedCredits);
        expect(finalWeighted).toBe(proj.expected.projectedWeightedPoints);
      });
    }
  });

  describe("classifications", () => {
    for (const cls of fixtures.classifications) {
      it(`classifies ${cls.cgpa} -> ${cls.expected.classification}`, () => {
        const result = classifyCgpa(cls.cgpa);
        expect(result.classification).toBe(cls.expected.classification);
        expect(result.isDegreeEligible).toBe(cls.expected.isDegreeEligible);
      });
    }
  });

  describe("gradeImprovement", () => {
    for (const item of fixtures.gradeImprovement) {
      it(`improvement for ${item.letterGrade} at CGPA ${item.cgpa} -> ${item.expected}`, () => {
        const result = isGradeImprovementEligible(item.letterGrade as any, item.cgpa);
        expect(result).toBe(item.expected);
      });
    }
  });
});

