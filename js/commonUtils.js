//---------------------------------------------------------------------------
//  File: CommonUtils.js  全局变量和函数
//  Change: 杨国强，创建于2016-10-24
//
//---------------------------------------------------------------------------



const fs = require('fs');
const readline = require('readline');


var GlobalVar = {
	TILE_SIZE : 512.0 / 45.0,
	BaseDate : Date.parse('2014-04-28 00:00:00'),
	
	LonRange : [115.16143798828125, 117.74224853515625],
	LatRange : [39.285980224609375, 41.23357391357422],
	
	// 影响策略的参数
	PlanParamProperty : [
		{
			name: '干预时间(小时)',
			values: [7, 19, 31, 43, 55, 67, 79, 91, 103, 115, 127, 139, 151],
		},
		{
			name: '物资储备水平(%)',
			isPercent: true,
			values: [1.00, 0.75, 0.50, 0.25],
		}
	],
	
	personStateToStr : function(s) {
		let pLayerName = '';
		switch (s) {
			case 0: pLayerName='受感染人口';	break;
			case 1: pLayerName='前驱期人口';	break;
			case 2: pLayerName='明显症状人口';	break;
			case 3: pLayerName='康复人口';	break;
			case 4: pLayerName='死亡人口';	break;
		}
		return pLayerName;
	},
}