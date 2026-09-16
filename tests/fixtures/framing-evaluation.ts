/**
 * 실제 모델 수동 평가에도 재사용할 비민감 fixture. expected는 사용자 요구에 따른 판정 기준이다.
 * 오프라인 테스트의 mock 응답은 의미 품질을 입증하지 않으며 전달/검증/표시 계약만 확인한다.
 */
import type { ContentNature } from '../../src/classification';
export const framingEvaluation: { id: string; text: string; expected: ContentNature; concepts: string[] }[] = [
  { id: 'korean-information', text: '효율적 시장 가설과 분산투자에 대해 설명한다. 효율적 시장 가설은 가격의 정보 반영을 설명하는 이론이다.', expected: 'information', concepts: ['효율적 시장 가설', '분산투자'] },
  { id: 'english-information', text: 'This note explains Behavioral Finance and Risk Parity.', expected: 'information', concepts: ['Behavioral Finance', 'Risk Parity'] },
  { id: 'korean-acronym', text: '자본자산 가격결정 모형(CAPM)을 이용한다.', expected: 'information', concepts: ['자본자산 가격결정 모형(CAPM)'] },
  { id: 'source-acronym', text: 'CAPM을 이용한다.', expected: 'information', concepts: ['CAPM'] },
  { id: 'personal-argument', text: '나는 개별주식보다 ETF 투자가 대부분의 개인투자자에게 적합하다고 생각한다. 직접 기업을 고르는 시간보다 다른 일에 집중하는 편이 낫다는 것이 내 판단이다.', expected: 'opinion', concepts: ['ETF'] },
  { id: 'substantial-mixed', text: '효율적 시장 가설에서는 지속적인 초과수익 창출이 어렵다고 본다. 시장 가격은 이용 가능한 정보를 반영한다는 이론이다.\n\n나는 이를 고려할 때 개인투자자는 인덱스 투자를 기본 전략으로 삼는 것이 좋다고 본다. 내 투자에서는 기업 선택보다 비용 관리가 더 중요하다고 판단한다.', expected: 'mixed', concepts: ['효율적 시장 가설', '인덱스 투자'] },
  { id: 'insufficient', text: '??? ...', expected: 'unclassified', concepts: [] },
  { id: 'information-minor-opinion', text: '분산투자는 여러 자산에 투자하는 방식이다. 자산 간 상관관계와 비중에 따라 포트폴리오의 위험이 달라진다. 비체계적 위험은 개별 기업의 상황에 관련된 위험이다. 체계적 위험은 시장 전체에 영향을 주는 요인과 관련된다. ETF는 여러 자산을 담을 수 있는 상장 펀드다. 투자자는 거래소에서 ETF를 거래할 수 있다.\n\n나는 이 설명이 흥미로웠다.', expected: 'information', concepts: ['분산투자', '비체계적 위험', '체계적 위험', 'ETF'] },
  { id: 'opinion-minor-information', text: '나는 투자에서 단순함이 가장 중요하다고 생각한다. 매일 종목을 바꾸는 전략은 내 생활 방식과 맞지 않는다. 수익률 예측에 시간을 쓰기보다 장기 계획을 지키는 편이 낫다고 본다. 나는 낮은 비용과 관리 편의성을 우선한다. 내게는 여러 기업을 직접 분석하는 부담이 크다. 그래서 나는 ETF 중심의 투자가 더 적합하다고 판단한다.\n\nETF는 거래소에서 거래되는 펀드다.', expected: 'opinion', concepts: ['ETF'] },
];
