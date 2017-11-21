//---------------------------------------------------------------------------
//  File: PolluteLayer.js
//  Change: 杨国强，创建于2016-09-12
//
//---------------------------------------------------------------------------

function PolluteLayer(layer) {
	if (!layer.data) {
		console.error("没有指定数据来源");
		return;
	}
	var v = layer.data;

	let pDataTime = []; // 累计浓度取log log，再归一化为0-1
	for (let i=0;i<v.TimeData.length;i++) {
		if (typeof(v.TimeData[i])!='number')
			v.TimeData[i] = Date.parse(v.TimeData[i]);
			
		pDataTime[i] = [];
		let maxD = 0;
		for (let j=0,jn=v.VarData[i].length;j<jn;j++) {
			if (v.VarData[i][j]==0) {
				pDataTime[i][j] = 0;
			} else {
				pDataTime[i][j] = Math.log(1+Math.log(1+50*v.VarData[i][j]));
				//pDataTime[i][j] *= pDataTime[i][j];
				if (maxD < pDataTime[i][j])
					maxD = pDataTime[i][j];
			}
		}
		if (maxD>0) {
			for (let j=0,jn=pDataTime[i].length;j<jn;j++)
				pDataTime[i][j] /= maxD;
		}
	}

	var previewCanvas, mainCanvas;
	var drawMain = null, drawPreview = null;

	var dataChanged = false;
	
	var indices = [];
		
	var vertexShaderStr = `
				precision lowp float;
				const float RADIAN_HALF = 3.1415926536/360.0;
				const float RADIAN_REVERSE = 180.0/3.1415926536;
				
				vec2 mercatorProjectViewport(
				  vec2 lnglat,
				  vec3 mapParam, /* center lat, center lon, zoom */
				  vec2 viewport /* viewport: [width, height] */
				) {
					float y2 = log(tan(RADIAN_HALF*90.0+ lnglat.y * RADIAN_HALF));
	        return vec2( (lnglat.x - mapParam.x) * mapParam.z / viewport[0],
	            (y2 - mapParam.y) * RADIAN_REVERSE * mapParam.z / viewport[1] );
				}
				
//				float hue2rgb(float p, float q, float t ) {
//					if ( t < 0.0 ) t += 1.0;
//					if ( t > 1.0 ) t -= 1.0;
//					if ( t < 1.0 / 6.0 ) return p + ( q - p ) * 6.0 * t;
//					if ( t < 1.0 / 2.0 ) return q;
//					if ( t < 2.0 / 3.0 ) return p + ( q - p ) * 6.0 * ( 2.0 / 3.0 - t );
//					return p;
//				}
//				vec3 hsl2rgb(float h, float s, float l ) {
//					if ( s == 0.0 ) {
//						return vec3(l,l,l);
//					} else {
//						float p = (l <= 0.5) ? l * ( 1.0 + s ) : l + s - ( l * s );
//						float q = ( 2.0 * l ) - p;
//						return vec3( hue2rgb( q, p, h + 1.0 / 3.0 ), hue2rgb( q, p, h ), hue2rgb( q, p, h - 1.0 / 3.0 ));
//					}
//				}
				
				attribute float posLat;
				attribute float posLon;
				attribute float density;
				uniform vec4 latlonRange;
				uniform vec2 dataRange;
				uniform vec3 mapParam;  /* center lat, center lon, zoom */ 
				uniform vec2 viewPort;
				uniform vec3 startColor;
				uniform vec3 midColor1;
				uniform vec3 midColor2;
				uniform vec3 midColor3;
				uniform vec3 endColor;
				uniform vec3 segment;
				varying vec4 finalColor;
				void main(void)
				{
				    float ratio = density;
				    if (ratio>segment[0]) {
				    	finalColor = vec4(midColor1 + (startColor-midColor1)*(ratio-segment[0])/(1.0-segment[0]), 1.0);
				    } else if (ratio>segment[1]) {
				    	finalColor = vec4(midColor2+(midColor1-midColor2)*(ratio-segment[1])/(segment[0]-segment[1]), 1.0);
				    } else if (ratio>segment[2]) {
				    	finalColor = vec4(midColor3+(midColor2-midColor3)*(ratio-segment[2])/(segment[1]-segment[2]), 1.0);
				    } else {
				    	finalColor = vec4(endColor+(midColor3-endColor)*(ratio)/(segment[2]), 1.0);
				    }
				    if (ratio<=segment[2])
				    	finalColor.w = 0.1+2.0*ratio/segment[2];
				    if (ratio==0.0)
				    	finalColor.w = 0.0;
				    if (latlonRange[0]<=0.0)
				    	gl_Position = vec4(mercatorProjectViewport(vec2(posLon,posLat), mapParam, viewPort), 0.0, 1.0);
				    else
				    	gl_Position = vec4((posLon-latlonRange[0])/latlonRange[1],(posLat-latlonRange[2])/latlonRange[3], 0.0, 1.0);
				}
	`;

	var fragmentShaderStr = `
    	precision mediump float;
    	varying vec4 finalColor;
			uniform float layerOpacity;
    	void main(void)
    	{
    		gl_FragColor = vec4(finalColor.xyz, layerOpacity*finalColor.w);
    	}`;
	
	function getTraingleBufExtend(buf, v, res) {
		var rows = v.VarDataDim[0];
		var stride = v.VarDataDim[1];
		
		var index = 0;
		if (!res)
			res = [];

		for (let j=0;j<rows-1;j++) {
			for (let i=0;i<stride-1;i++) {
				let base = j*stride + i;
				res[index++] = buf[base];
				res[index++] = buf[base + 1];
				res[index++] = buf[base + stride];
				res[index++] = buf[base + 1];
				res[index++] = buf[base + stride];
				res[index++] = buf[base + stride + 1];
			}
		}
		return new Float32Array(res);
	}
	
	function getTraingleBuf(bufOrigin, v) {
		var rows = v.VarDataDim[0];
		var stride = v.VarDataDim[1];
		
		var index = 0;
		var buf = [];
		for (let j=0;j<rows*2 - 1;j++) {
			let r = (j/2) | 0;
			if (j==r*2) {
				for (let i=0;i<stride*2 - 1;i++) {
					let c = (i/2)|0;
					if (i==c*2)
						buf[index++] = bufOrigin[r*stride+c];
					else
						buf[index++] = (bufOrigin[r*stride+c+1]+bufOrigin[r*stride+c]) / 2;
				}
			} else {
				for (let i=0;i<stride*2 - 1;i++) {
					let c = (i/2)|0;
					if (i==c*2)
						buf[index++] = (bufOrigin[(r+1)*stride+c]+bufOrigin[r*stride+c]) / 2;
					else
						buf[index++] = (bufOrigin[(r+1)*stride+c+1]+bufOrigin[(r+1)*stride+c]+bufOrigin[r*stride+c+1]+bufOrigin[r*stride+c]) / 4;
				}
			}
		}
		
		index = 0;
		rows = rows*2-1;
		stride = stride*2-1;
		var res = [];
		for (let j=0;j<rows-1;j++) {
			for (let i=0;i<stride-1;i++) {
				let base = j*stride + i;
				res[index++] = buf[base];
				res[index++] = buf[base + 1];
				res[index++] = buf[base + stride];
				res[index++] = buf[base + 1];
				res[index++] = buf[base + stride];
				res[index++] = buf[base + stride + 1];
			}
		}
		return new Float32Array(res);
	}
	
	function initCanvas() {
		
		$("#layerLegend"+layer.id).html('<span>'+v.VarDataRange[0].toFixed(3)+'</span><span style="position:absolute;left:250px">'+v.VarDataRange[1].toFixed(3)+'</span>'
				+'<div style="margin-left:20px;height:10px;width:100px;background:linear-gradient(to left, rgb(125,0,0), rgb(255,0,0), rgb(220,255,25), rgb(25,50,255), rgb(0,0,125))">'+'</div>');
		
		previewCanvas = document.getElementById('layerPreviewCanvas');
		mainCanvas = document.getElementById('layerMainCanvas');
		if (viewerIndex==0) // 只有第一个二维视图负责绘制缩略图
			drawPreview = initWebGL(previewCanvas, 1);
		drawMain = initWebGL(mainCanvas, 0);
	}

	function initWebGL(canvasObject, isPreview) {
		let webgl = canvasObject.getContext('webgl');
    let vertexShaderObject = webgl.createShader(webgl.VERTEX_SHADER);
    let fragmentShaderObject = webgl.createShader(webgl.FRAGMENT_SHADER);

    webgl.shaderSource(vertexShaderObject, vertexShaderStr);
    webgl.shaderSource(fragmentShaderObject, fragmentShaderStr);

    webgl.compileShader(vertexShaderObject);
    webgl.compileShader(fragmentShaderObject);

    if(!webgl.getShaderParameter(fragmentShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(fragmentShaderObject));return;}
    if(!webgl.getShaderParameter(vertexShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(vertexShaderObject));return;}

    let programObject = webgl.createProgram();

    webgl.attachShader(programObject, vertexShaderObject);
    webgl.attachShader(programObject, fragmentShaderObject);

    webgl.linkProgram(programObject);
    if(!webgl.getProgramParameter(programObject, webgl.LINK_STATUS)){console.error(webgl.getProgramInfoLog(programObject));return;}
    webgl.useProgram(programObject);

    let attrPosLat = webgl.getAttribLocation(programObject, "posLat");
    let attrPosLon = webgl.getAttribLocation(programObject, "posLon");
    let attrDensity = webgl.getAttribLocation(programObject, "density");
    let attrLatlonRange = webgl.getUniformLocation(programObject, "latlonRange");
    let attrDataRange = webgl.getUniformLocation(programObject, "dataRange");
    let attrMapParam = webgl.getUniformLocation(programObject, "mapParam");
    let attrViewPort = webgl.getUniformLocation(programObject, "viewPort");
    let attrOpacity = webgl.getUniformLocation(programObject, "layerOpacity");
    let attrSegment = webgl.getUniformLocation(programObject, "segment");
	  webgl.uniform3fv(attrSegment, [0.9,0.8,0.7]);
		let attrColorStep = [webgl.getUniformLocation(programObject, "startColor"),webgl.getUniformLocation(programObject, "midColor1"),
    webgl.getUniformLocation(programObject, "midColor2"),webgl.getUniformLocation(programObject, "midColor3"),webgl.getUniformLocation(programObject, "endColor")];
	  webgl.uniform3fv(attrColorStep[0], [0.3,0,0]);
	  webgl.uniform3fv(attrColorStep[1], [1,0,0]);
	  webgl.uniform3fv(attrColorStep[2], [0.9,0.9,0]);
	  webgl.uniform3fv(attrColorStep[3], [0.3,0.9,0.4]);
	  webgl.uniform3fv(attrColorStep[4], [0.2,0.3,0.9]);

	  webgl.uniform2fv(attrDataRange, v.VarDataRange);	
	  if (isPreview)
		  webgl.uniform4f(attrLatlonRange, v.LonCenter, (v.LonRange[1]-v.LonRange[0])/2, v.LatCenter, (v.LatRange[1]-v.LatRange[0])/2);
		else
		  webgl.uniform4f(attrLatlonRange, -1, 0,0,0);
	  webgl.uniform1f(attrOpacity, 1);
    
    let latBuffer = webgl.createBuffer();
    let lonBuffer = webgl.createBuffer();
		let indexBuffer = webgl.createBuffer();
    let densityBuffer = webgl.createBuffer();

    webgl.bindBuffer(webgl.ARRAY_BUFFER, latBuffer);
    webgl.bufferData(webgl.ARRAY_BUFFER, getTraingleBuf(v.LatData, v), webgl.STATIC_DRAW);
    webgl.bindBuffer(webgl.ARRAY_BUFFER, lonBuffer);
    webgl.bufferData(webgl.ARRAY_BUFFER, getTraingleBuf(v.LonData, v), webgl.STATIC_DRAW);

	  return function() {
	  	if (indices.length<=0)
	  		return;
			webgl.useProgram(programObject);
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, latBuffer);
		  webgl.enableVertexAttribArray(attrPosLat); 
		  webgl.vertexAttribPointer(attrPosLat, 1, webgl.FLOAT, false, 0, 0);
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, lonBuffer);
		  webgl.enableVertexAttribArray(attrPosLon); 
		  webgl.vertexAttribPointer(attrPosLon, 1, webgl.FLOAT, false, 0, 0);
		
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, densityBuffer);
		  if (dataChanged) {
		  	webgl.bufferData(webgl.ARRAY_BUFFER, indices, webgl.STATIC_DRAW);	
		  }
		  webgl.enableVertexAttribArray(attrDensity); 
		  webgl.vertexAttribPointer(attrDensity, 1, webgl.FLOAT, false, 0, 0);
		
	  	if (!isPreview) {
			let temp = ol.proj.toLonLat(map.getView().getCenter());
			let center = {lon:temp[0], lat:temp[1]};//map.center();
			temp = map.getSize();
			let size = {x:temp[0],y:temp[1]};//map.size();
			  let mapedlat = Math.log(Math.tan(Math.PI / 4.0 + center.lat * Math.PI / 360.0));
				let k = Math.pow(2, map.getView().getZoom() - 3) * 512.0 / 45.0;
			  webgl.uniform3fv(attrMapParam, [center.lon, mapedlat, k]);
			  webgl.uniform2fv(attrViewPort, [size.x,size.y]);
			  webgl.uniform1f(attrOpacity, layer.opacity);
			
			  webgl.drawArrays(webgl.TRIANGLES, 0, indices.length);
			} else {
			  webgl.clearColor(0.0, 0.0, 0.0, 0.8);
			  webgl.clear(webgl.COLOR_BUFFER_BIT);
			  webgl.drawArrays(webgl.TRIANGLES, 0, indices.length);
			}
	  }
	  
	}

	// 根据时间t更新数据
	var currentDensityData;
	var timeIndex = 0;
	var timeData = [];
	layer.onTick = function(t) {
		timeIndex = 0;
		for (var i=0;i<v.TimeData.length;i++)
			if (v.TimeData[i]<=t)
				timeIndex = i;
		if (currentDensityData != pDataTime[timeIndex]) {
			if (!timeData[timeIndex]) {
				currentDensityData = pDataTime[timeIndex];
		  	indices = getTraingleBuf(currentDensityData, v);
		  	timeData[timeIndex] = indices;
			} else {
				indices = timeData[timeIndex];
			}
			dataChanged = true;
			if (drawPreview) {
				drawPreview();
		  	setLayerPreviewImg(layer.id, previewCanvas.toDataURL("image/png")); 
			}
		}
	}
	
	layer.onDraw = function() {
		if (drawMain)
			drawMain();
		dataChanged = false;
	}
	
	// 鼠标移动时显示鼠标所在位置的数值
	layer.onMouseMove = function(pos) {
		var data = v.VarData[timeIndex];
		if (pos.lon>v.LonRange[0]&&pos.lon<=v.LonRange[1] && pos.lat>v.LatRange[0]&&pos.lat<=v.LatRange[1]) {
			var i = Math.trunc(0.5+((pos.lon-v.LonRange[0]) * v.VarDataDim[0] / (v.LonRange[1]-v.LonRange[0])));
			var j = Math.trunc(0.5+((pos.lat-v.LatRange[0]) * v.VarDataDim[1] / (v.LatRange[1]-v.LatRange[0])));
			let theData = data[(j-1)*v.VarDataDim[1] + i-1];
			if (!theData) theData = 0;
			setLayerPreviewInfo(layer.id, theData.toFixed(5)+' '+layer.unit);
		}
	}
	
	initCanvas();
}
